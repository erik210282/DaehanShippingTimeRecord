CREATE OR REPLACE FUNCTION rls_internal.production_live_action_progress_base(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();manager boolean;v_now timestamptz:=clock_timestamp();report_at timestamptz;v_id uuid;v_item uuid;v_station text;v_start timestamptz;v_quantity bigint;v_hours integer;v_target numeric;r public.production_live_runs;t public.production_targets;c public.production_checkpoints;v_session uuid;entry jsonb;result jsonb;results jsonb:='[]'::jsonb;existed boolean;closing boolean:=p_action in ('finish','finish_batch');event jsonb;events jsonb;event_start timestamptz;event_end timestamptz;seen tstzrange[]:=array[]::tstzrange[];
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 if p_action in('checkpoint','checkpoint_batch') then
  v_now:=coalesce(nullif(p_data->>'recorded_at','')::timestamptz,case when p_action='checkpoint_batch' then nullif(p_data->'products'->0->>'recorded_at','')::timestamptz end,v_now);
  if not isfinite(v_now) or v_now>clock_timestamp() then raise exception 'rp_time_invalid';end if;
 end if;
 if closing then
  if p_action='finish_batch' then v_now:=nullif(p_data->'products'->0->>'finished_at','')::timestamptz;
  else v_now:=nullif(p_data->>'finished_at','')::timestamptz;end if;
  if v_now is null or v_now>clock_timestamp() then raise exception 'pl_finish_invalid';end if;
 end if;
 if p_action='finish' then p_action:='checkpoint';end if;
 if p_action in ('checkpoint_batch','target_batch','close_batch','finish_batch') then
  if jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 or (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'item_id' loop
   if p_action='finish_batch' and nullif(entry->>'finished_at','')::timestamptz is distinct from v_now then raise exception 'pr_time_invalid';end if;
   if p_action='checkpoint_batch' then
    if nullif(entry->>'recorded_at','')::timestamptz is not null and (entry->>'recorded_at')::timestamptz is distinct from v_now then raise exception 'rp_time_invalid';end if;
    entry:=entry||jsonb_build_object('recorded_at',v_now);
   end if;
   existed:=exists(select 1 from public.production_checkpoints where id=nullif(entry->>'id','')::uuid);
   result:=rls_internal.production_live_action(case when p_action='target_batch' then 'target' when p_action='close_batch' then 'close' when p_action='finish_batch' then 'finish' else 'checkpoint' end,entry);
   if p_action='checkpoint_batch' and not existed then
    update public.production_checkpoints set recorded_at=v_now where id=(entry->>'id')::uuid;
    perform rls_internal.production_live_recalculate((entry->>'run_id')::uuid);
    select to_jsonb(x) into result from public.production_checkpoints x where id=(entry->>'id')::uuid;
   end if;
   results:=results||jsonb_build_array(result);
  end loop;
  return jsonb_build_object('saved',true,'products',results);
 end if;
 if p_action in('target','delete_target','restore_target') then
  if not manager then raise exception 'pr_forbidden';end if;
  v_item:=(p_data->>'item_id')::uuid;
  if p_action<>'target' then
   update public.production_targets set deleted_at=case when p_action='delete_target' then v_now else null end,updated_by=uid,updated_at=v_now where item_id=v_item;
   return jsonb_build_object('saved',true);
  end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  -- Preserve compatibility with installed older mobile clients during rollout.
  if p_data ? 'target_8h' then
   if coalesce(p_data->>'target_8h','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'target_10h','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=(p_data->>'target_8h')::numeric;t.target_10h:=(p_data->>'target_10h')::numeric;
  else
   if coalesce(p_data->>'pieces_per_hour','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=round((p_data->>'pieces_per_hour')::numeric*8);t.target_10h:=round((p_data->>'pieces_per_hour')::numeric*10);
  end if;
  if coalesce(p_data->>'warning_percent','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'critical_percent','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
  t.warning_percent:=(p_data->>'warning_percent')::numeric;t.critical_percent:=(p_data->>'critical_percent')::numeric;
  if t.target_8h<=0 or t.target_10h<=0 or t.target_8h>100000000 or t.target_10h>100000000 or t.warning_percent>100 or t.critical_percent<=0 or t.critical_percent>=t.warning_percent then raise exception 'pl_target_invalid';end if;
  t.target_10h:=t.target_8h/7.5*9.3;
  insert into public.production_targets(item_id,target_8h,target_10h,pieces_per_hour,interval_hours,warning_percent,critical_percent,updated_by,updated_at)
  values(v_item,t.target_8h,t.target_10h,t.target_8h::numeric/7.5,2,t.warning_percent,t.critical_percent,uid,v_now)
  on conflict(item_id) do update set target_8h=excluded.target_8h,target_10h=excluded.target_10h,pieces_per_hour=excluded.pieces_per_hour,warning_percent=excluded.warning_percent,critical_percent=excluded.critical_percent,updated_by=uid,updated_at=v_now,deleted_at=null;
  return jsonb_build_object('saved',true);
 end if;
 if p_action in('edit_checkpoint','delete_checkpoint','restore_checkpoint') then
  v_id:=(p_data->>'id')::uuid;
  select * into c from public.production_checkpoints where id=v_id;
  if c.id is null then raise exception 'pr_invalid';end if;
  select * into r from public.production_live_runs where id=c.run_id for update;
  if r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='edit_checkpoint' then
   if c.deleted_at is not null then raise exception 'pl_report_deleted';end if;
   if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
   report_at:=coalesce(nullif(p_data->>'recorded_at','')::timestamptz,c.recorded_at);
   if not isfinite(report_at) or report_at>clock_timestamp() then raise exception 'rp_time_invalid';end if;
   if report_at is distinct from c.recorded_at then
    if c.recorded_at=r.closed_at then raise exception 'rp_final_locked';end if;
    if report_at<r.started_at or report_at=r.started_at and (p_data->>'quantity')::bigint>0 or r.closed_at is not null and report_at>r.closed_at or exists(select 1 from jsonb_array_elements(r.closed_intervals) g where report_at>=(g->>'start_at')::timestamptz and report_at<(g->>'end_at')::timestamptz) then raise exception 'rp_time_invalid';end if;
    if exists(select 1 from public.production_checkpoints where run_id=r.id and id<>c.id and deleted_at is null and recorded_at=report_at) then raise exception 'rp_time_exists';end if;
   end if;
   update public.production_checkpoints set quantity=(p_data->>'quantity')::bigint,recorded_at=report_at,updated_at=clock_timestamp(),updated_by=uid where id=v_id;
  else
   update public.production_checkpoints set deleted_at=case when p_action='delete_checkpoint' then v_now else null end,updated_at=v_now,updated_by=uid where id=v_id;
  end if;
  perform rls_internal.production_live_recalculate(r.id);
  select * into c from public.production_checkpoints where id=v_id;
  return to_jsonb(c);
 end if;
 if p_action in('close','edit_run','delete_run','restore_run') then
  select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
  if r.id is null or (p_action<>'close' and not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='delete_run' then
   update public.production_live_runs set deleted_at=v_now,updated_at=v_now,updated_by=uid where id=r.id;
  elsif p_action='restore_run' then
   perform pg_advisory_xact_lock(hashtextextended(r.station_code,1));
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=r.station_code and id<>r.id and (session_id<>r.session_id or item_id=r.item_id) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   update public.production_live_runs set deleted_at=null,updated_at=v_now,updated_by=uid where id=r.id;
  elsif r.deleted_at is not null then raise exception 'pl_report_deleted';
  elsif p_action='close' then
   update public.production_live_runs set closed_at=coalesce(closed_at,v_now),updated_at=v_now,updated_by=uid where id=r.id;
  else
   v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=(p_data->>'shift_hours')::integer;
   if jsonb_array_length(r.closed_intervals)>0 and (v_start is distinct from r.started_at or v_station is distinct from r.station_code or v_item is distinct from r.item_id) then raise exception 'pr_time_invalid';end if;
   if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
   if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
   if v_start is null or v_start>=coalesce((select min(recorded_at) from public.production_checkpoints where run_id=r.id and deleted_at is null),v_now) or v_hours not in(8,10) or v_hours is null then raise exception 'pl_start_invalid';end if;
   perform pg_advisory_xact_lock(hashtextextended(v_station,1));
   if exists(select 1 from public.production_live_runs x where x.id<>r.id and x.session_id=r.session_id and x.deleted_at is null and (x.station_code<>v_station or x.started_at<>v_start or x.shift_hours<>v_hours)) then raise exception 'pr_time_invalid';end if;
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=v_station and id<>r.id and (session_id<>r.session_id or item_id=v_item) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   if r.item_id<>v_item or r.shift_hours<>v_hours then
    select * into t from public.production_targets where item_id=v_item and deleted_at is null;
    -- Missing targets are permitted until the real values are published.
    v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
   else v_target:=r.shift_target;end if;
   update public.production_live_runs set station_code=v_station,item_id=v_item,started_at=v_start,shift_hours=v_hours,shift_target=v_target,pieces_per_hour=v_target/(case when v_hours=10 then 9.3 else 7.5 end),warning_percent=case when r.item_id<>v_item then coalesce(t.warning_percent,90) else r.warning_percent end,critical_percent=case when r.item_id<>v_item then coalesce(t.critical_percent,75) else r.critical_percent end,updated_at=v_now,updated_by=uid where id=r.id;
   perform rls_internal.production_live_recalculate(r.id);
  end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_action is distinct from 'checkpoint' then raise exception 'pr_invalid';end if;
 v_id:=(p_data->>'id')::uuid;
 if v_id is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
 select * into c from public.production_checkpoints where id=v_id;
 if c.id is not null then
  if c.created_by<>uid then raise exception 'pr_forbidden';end if;
  if c.deleted_at is not null or exists(select 1 from public.production_live_runs where id=c.run_id and deleted_at is not null) then raise exception 'pl_report_deleted';end if;
  return to_jsonb(c);
 end if;
 if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
 v_quantity:=(p_data->>'quantity')::bigint;
 select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
 if r.id is null then
  if closing then raise exception 'pr_invalid';end if;
  v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=coalesce((p_data->>'shift_hours')::integer,8);
  if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  if v_start is null or v_start>=v_now or v_start<v_now-interval '24 hours' or v_hours not in(8,10) then raise exception 'pl_start_invalid';end if;
  select * into t from public.production_targets where item_id=v_item and deleted_at is null;
  -- Missing targets are permitted until the real values are published.
  v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
  perform pg_advisory_xact_lock(hashtextextended(v_station,1));
  v_session:=coalesce((p_data->>'session_id')::uuid,(p_data->>'run_id')::uuid);
  if exists(select 1 from public.production_live_runs x where x.session_id=v_session and (x.created_by<>uid or x.station_code<>v_station or x.started_at<>v_start or x.shift_hours<>v_hours or x.closed_at is not null or x.deleted_at is not null)) then raise exception 'pr_forbidden';end if;
  if exists(select 1 from public.production_live_runs where station_code=v_station and (session_id<>v_session or item_id=v_item) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
  insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
  values((p_data->>'run_id')::uuid,v_session,v_station,v_item,v_start,uid,v_target/(case when v_hours=10 then 9.3 else 7.5 end),2,coalesce(t.warning_percent,90),coalesce(t.critical_percent,75),v_hours,v_target) returning * into r;
 else
  if r.deleted_at is not null then raise exception 'pr_forbidden';end if;
  if r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if v_now>r.started_at+interval '24 hours' then raise exception 'pl_expired';end if;
  if closing and (v_now<=r.started_at or exists(select 1 from jsonb_array_elements(r.closed_intervals) where (value->>'end_at')::timestamptz>=v_now)) then raise exception 'pl_finish_invalid';end if;
  if closing and v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
  if v_now<r.started_at or v_now=r.started_at and v_quantity>0 or exists(select 1 from jsonb_array_elements(r.closed_intervals) g where v_now>=(g->>'start_at')::timestamptz and v_now<(g->>'end_at')::timestamptz) then raise exception 'rp_time_invalid';end if;
  if not closing and exists(select 1 from public.production_checkpoints where run_id=r.id and deleted_at is null and recorded_at=v_now) then raise exception 'rp_time_exists';end if;
 end if;
 if p_data ? 'downtime_events' then
  events:=coalesce((select jsonb_agg(value) from jsonb_array_elements(p_data->'downtime_events') where value->>'type' is distinct from 'inactive'),'[]');
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>1000 then raise exception 'pr_downtime_invalid';end if;
  for event in select value from jsonb_array_elements(events) loop
   if event->>'type' is null or event->>'type' not in ('break','lunch','maintenance','breakdown','inactive') then raise exception 'pr_downtime_invalid';end if;
   event_start:=nullif(event->>'start_at','')::timestamptz;event_end:=nullif(event->>'end_at','')::timestamptz;
   if event_start is null or event_end is null or event_end<=event_start or event_start<date_trunc('minute',r.started_at) or event_end>v_now then raise exception 'pr_downtime_schedule_invalid';end if;
   if exists(select 1 from unnest(seen) span where span && tstzrange(event_start,event_end,'[)')) then raise exception 'pr_downtime_overlap';end if;
   seen:=array_append(seen,tstzrange(event_start,event_end,'[)'));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('live-session:'||r.session_id,2));
  update public.production_live_runs set downtime_events=events,updated_at=clock_timestamp(),updated_by=uid where id=r.id;
 end if;
 -- Actual closure is independent of capture time. Keep late reports intact;
 -- recalculate uses the final checkpoint at closed_at as the authoritative total.
 if closing then update public.production_live_runs set closed_at=v_now,updated_at=clock_timestamp(),updated_by=uid where id=r.id;end if;
 insert into public.production_checkpoints(id,run_id,recorded_at,quantity,created_by,expected_quantity,attainment,performance)
 values(v_id,r.id,v_now,v_quantity,uid,1,0,'on_track') returning * into c;
 perform rls_internal.production_live_recalculate(r.id);
 select * into c from public.production_checkpoints where id=v_id;
 return to_jsonb(c);
end $function$
;

