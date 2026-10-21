CREATE OR REPLACE FUNCTION rls_internal.production_live_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; entry jsonb; lr public.production_live_runs; zone text; start_local timestamp; finish_local timestamp; elapsed numeric; unplanned numeric; planned numeric; breaks integer; events jsonb; uid uuid:=auth.uid(); reopen_at timestamptz;
begin
 if not (rls_internal.role_activity_access('production',case when p_action like 'target%' then 'targets' else 'partial' end) or (p_action in ('start','start_batch','finish','finish_batch','close','close_batch') and rls_internal.role_activity_access('production','shifts'))) then raise exception 'ra_denied';end if;
 if p_action='reopen' then
  if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
  select station_code into zone from public.production_live_runs where id=(p_data->>'run_id')::uuid;
  if zone is null then raise exception 'pr_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended(zone,1));
  select * into lr from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
  if lr.deleted_at is not null or not (public.inventory_access('production',true) or lr.created_by=uid or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
  if lr.closed_at is null then
   if exists(select 1 from jsonb_array_elements(lr.closed_intervals) where (value->>'start_at')::timestamptz=nullif(p_data->>'closed_at','')::timestamptz) then return jsonb_build_object('saved',true);end if;
   raise exception 'pl_reopen_changed';
  end if;
  if lr.closed_at is distinct from nullif(p_data->>'closed_at','')::timestamptz then raise exception 'pl_reopen_changed';end if;
  reopen_at:=greatest(lr.closed_at,date_trunc('minute',clock_timestamp()));
  if reopen_at>=lr.started_at+interval '24 hours' or reopen_at<lr.closed_at or jsonb_array_length(lr.closed_intervals)>=100 then raise exception 'pl_reopen_expired';end if;
  if exists(select 1 from public.production_station_reports where live_run_id=lr.id and status<>'draft') then raise exception 'pl_reopen_posted';end if;
  if exists(select 1 from public.production_live_runs x where x.station_code=lr.station_code and x.id<>lr.id and x.deleted_at is null and x.closed_at is null and (x.session_id<>lr.session_id or x.item_id=lr.item_id)) then raise exception 'pl_station_busy';end if;
  update public.production_live_runs set closed_at=null,closed_intervals=closed_intervals||jsonb_build_array(jsonb_build_object('start_at',lr.closed_at,'end_at',reopen_at,'reopened_by',uid)),updated_at=clock_timestamp(),updated_by=uid where id=lr.id;
  update public.production_station_reports set capture_group_id=id,progress_draft=true,updated_at=clock_timestamp() where live_run_id=lr.id and status='draft';
  perform rls_internal.production_live_recalculate(lr.id);
  return jsonb_build_object('saved',true,'reopened_at',reopen_at);
 end if;
 if p_action='finish_batch' then
  p_data:=jsonb_set(p_data,'{products}',coalesce((select jsonb_agg(e||jsonb_build_object('capture_group_id',coalesce(p_data->'products'->0->>'capture_group_id',p_data->'products'->0->>'id'))) from jsonb_array_elements(p_data->'products') e),'[]'::jsonb));
 end if;
 result:=rls_internal.production_live_action_progress_base(p_action,p_data);
 if p_action in ('finish','finish_batch') then
  for entry in select value from jsonb_array_elements(case when p_action='finish_batch' then p_data->'products' else jsonb_build_array(p_data) end) loop
   select * into lr from public.production_live_runs where id=(entry->>'run_id')::uuid;
   if lr.id is null or lr.closed_at is null then raise exception 'pr_invalid';end if;
   zone:=coalesce(nullif(entry->>'timezone',''),'UTC');
   if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
   start_local:=lr.started_at at time zone zone;finish_local:=lr.closed_at at time zone zone;
   elapsed:=extract(epoch from lr.closed_at-lr.started_at)/60;
   select coalesce(jsonb_agg(e||jsonb_build_object('type',e->>'type','note',coalesce(e->>'note',''),'start_time',to_char((e->>'start_at')::timestamptz at time zone zone,'HH24:MI'),'end_time',to_char((e->>'end_at')::timestamptz at time zone zone,'HH24:MI'),'minutes',extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60)),'[]'::jsonb),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' not in ('break','lunch')),0),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' in ('break','lunch')),0),
    count(*) filter(where e->>'type' in ('break','lunch'))
   into events,unplanned,planned,breaks from jsonb_array_elements(lr.downtime_events) e;
   insert into public.production_station_reports(id,live_run_id,capture_group_id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,break_minutes,break_count,people,machine_quantity,scrap_quantity,rework_quantity,full_boxes,report_mode,downtime_events,status,created_by,progress_draft)
   values(gen_random_uuid(),lr.id,coalesce(nullif(entry->>'capture_group_id','')::uuid,(entry->>'id')::uuid),lr.station_code,lr.item_id,(select id from public.inventory_boms where finished_item_id=lr.item_id and active and not archived limit 1),start_local::date,start_local::time,finish_local::time,start_local::date<>finish_local::date,elapsed,greatest(0,elapsed-unplanned-planned),unplanned,planned,breaks,null,lr.latest_quantity,null,null,null,'production',events,'draft',auth.uid(),true)
   on conflict (live_run_id) where live_run_id is not null and report_mode='production' do update set capture_group_id=excluded.capture_group_id,end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,break_minutes=excluded.break_minutes,break_count=excluded.break_count,machine_quantity=excluded.machine_quantity,downtime_events=excluded.downtime_events,progress_draft=true,updated_at=clock_timestamp() where production_station_reports.status='draft';
  end loop;
 end if;
 return result;
end $function$;
