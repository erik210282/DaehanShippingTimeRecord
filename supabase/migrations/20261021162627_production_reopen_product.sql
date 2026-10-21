alter table public.production_live_runs add column if not exists closed_intervals jsonb not null default '[]'::jsonb;
alter table public.production_live_runs add constraint production_closed_intervals_array check (jsonb_typeof(closed_intervals)='array' and jsonb_array_length(closed_intervals)<=100);

create or replace function rls_internal.production_merge_fixed_events(p_start timestamptz,p_end timestamptz,p_events jsonb,p_zone text default 'America/Los_Angeles')
returns jsonb language plpgsql stable set search_path='' as $$
declare fixed jsonb:=rls_internal.production_fixed_events(p_start,p_end,p_zone);result jsonb:='[]';masked jsonb:='[]';inactive jsonb:='[]';e jsonb;f jsonb;a timestamptz;b timestamptz;piece tstzrange;pieces tstzmultirange;
begin
 if jsonb_typeof(coalesce(p_events,'[]'))<>'array' then raise exception 'pr_downtime_invalid';end if;
 for e in select value from jsonb_array_elements(coalesce(p_events,'[]')) where value->>'type'='inactive' loop
  a:=greatest(p_start,(e->>'start_at')::timestamptz);b:=least(p_end,(e->>'end_at')::timestamptz);
  if b>a then inactive:=inactive||jsonb_build_array(e||jsonb_build_object('start_at',a,'end_at',b));end if;
 end loop;
 result:=inactive;
 for e in select value from jsonb_array_elements(fixed) loop
  pieces:=tstzmultirange(tstzrange((e->>'start_at')::timestamptz,(e->>'end_at')::timestamptz,'[)'));
  for f in select value from jsonb_array_elements(inactive) loop pieces:=pieces-tstzmultirange(tstzrange((f->>'start_at')::timestamptz,(f->>'end_at')::timestamptz,'[)'));end loop;
  for piece in select unnest(pieces) loop masked:=masked||jsonb_build_array(e||jsonb_build_object('start_at',lower(piece),'end_at',upper(piece)));end loop;
 end loop;
 result:=result||masked;
 for e in select value from jsonb_array_elements(coalesce(p_events,'[]')) loop
  if e->>'type'='inactive' or coalesce((e->>'automatic')::boolean,false) then continue;end if;
  if not(e?'start_at' and e?'end_at') then
   if coalesce(e->>'type','') not in('break','lunch') then result:=result||jsonb_build_array(e);end if;continue;
  end if;
  a:=(e->>'start_at')::timestamptz;b:=(e->>'end_at')::timestamptz;
  if a is null or b is null or b<=a or a<p_start or b>p_end then raise exception 'pr_downtime_schedule_invalid';end if;
  pieces:=tstzmultirange(tstzrange(a,b,'[)'));
  for f in select value from jsonb_array_elements(masked||inactive) loop pieces:=pieces-tstzmultirange(tstzrange((f->>'start_at')::timestamptz,(f->>'end_at')::timestamptz,'[)'));end loop;
  for piece in select unnest(pieces) loop result:=result||jsonb_build_array(e||jsonb_build_object('start_at',lower(piece),'end_at',upper(piece)));end loop;
 end loop;
 return coalesce((select jsonb_agg(value order by (value->>'start_at')::timestamptz nulls last) from jsonb_array_elements(result)),'[]');
end $$;

create or replace function rls_internal.production_inactive_events(p_intervals jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(value||jsonb_build_object('type','inactive','planned',true,'automatic',true,'schedule_key','closed:'||(value->>'start_at'),'note','')),'[]') from jsonb_array_elements(p_intervals)
$$;
create or replace function rls_internal.production_automatic_run_breaks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.started_at is not null then
  new.downtime_events:=rls_internal.production_merge_fixed_events(new.started_at,coalesce(new.closed_at,clock_timestamp()),
   coalesce((select jsonb_agg(value) from jsonb_array_elements(new.downtime_events) where value->>'type' is distinct from 'inactive'),'[]')||rls_internal.production_inactive_events(new.closed_intervals),new.timezone);
 end if;return new;
end $$;
drop trigger production_automatic_run_breaks on public.production_live_runs;
create trigger production_automatic_run_breaks before insert or update of started_at,closed_at,downtime_events,timezone,closed_intervals on public.production_live_runs for each row execute function rls_internal.production_automatic_run_breaks();
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
  update public.production_station_reports set progress_draft=true,updated_at=clock_timestamp() where live_run_id=lr.id and status='draft';
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
   on conflict (live_run_id) where live_run_id is not null and report_mode='production' do update set end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,break_minutes=excluded.break_minutes,break_count=excluded.break_count,machine_quantity=excluded.machine_quantity,downtime_events=excluded.downtime_events,progress_draft=true,updated_at=clock_timestamp() where production_station_reports.status='draft';
  end loop;
 end if;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_live_action_progress_base(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();manager boolean;v_now timestamptz:=clock_timestamp();v_id uuid;v_item uuid;v_station text;v_start timestamptz;v_quantity bigint;v_hours integer;v_target numeric;r public.production_live_runs;t public.production_targets;c public.production_checkpoints;v_session uuid;entry jsonb;result jsonb;results jsonb:='[]'::jsonb;existed boolean;closing boolean:=p_action in ('finish','finish_batch');event jsonb;events jsonb;event_start timestamptz;event_end timestamptz;seen tstzrange[]:=array[]::tstzrange[];
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
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
   update public.production_checkpoints set quantity=(p_data->>'quantity')::bigint,updated_at=v_now,updated_by=uid where id=v_id;
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
    if t.item_id is null then raise exception 'pl_target_missing';end if;
    v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
   else v_target:=r.shift_target;end if;
   update public.production_live_runs set station_code=v_station,item_id=v_item,started_at=v_start,shift_hours=v_hours,shift_target=v_target,pieces_per_hour=v_target/(case when v_hours=10 then 9.3 else 7.5 end),warning_percent=case when r.item_id<>v_item then t.warning_percent else r.warning_percent end,critical_percent=case when r.item_id<>v_item then t.critical_percent else r.critical_percent end,updated_at=v_now,updated_by=uid where id=r.id;
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
  if t.item_id is null then raise exception 'pl_target_missing';end if;
  v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
  perform pg_advisory_xact_lock(hashtextextended(v_station,1));
  v_session:=coalesce((p_data->>'session_id')::uuid,(p_data->>'run_id')::uuid);
  if exists(select 1 from public.production_live_runs x where x.session_id=v_session and (x.created_by<>uid or x.station_code<>v_station or x.started_at<>v_start or x.shift_hours<>v_hours or x.closed_at is not null or x.deleted_at is not null)) then raise exception 'pr_forbidden';end if;
  if exists(select 1 from public.production_live_runs where station_code=v_station and (session_id<>v_session or item_id=v_item) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
  insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
  values((p_data->>'run_id')::uuid,v_session,v_station,v_item,v_start,uid,v_target/(case when v_hours=10 then 9.3 else 7.5 end),2,t.warning_percent,t.critical_percent,v_hours,v_target) returning * into r;
 else
  if r.deleted_at is not null then raise exception 'pr_forbidden';end if;
  if r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if v_now>r.started_at+interval '24 hours' then raise exception 'pl_expired';end if;
  if closing and (v_now<=r.started_at or exists(select 1 from jsonb_array_elements(r.closed_intervals) where (value->>'end_at')::timestamptz>=v_now)) then raise exception 'pl_finish_invalid';end if;
  if v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
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
CREATE OR REPLACE FUNCTION rls_internal.production_live_snapshot_range(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare manager boolean;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '367 days' then raise exception 'pr_invalid';end if;
 manager:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,coalesce((select jsonb_agg(to_jsonb(z)) from (select distinct pc.created_by as uid,o.nombre as name from public.production_checkpoints pc left join public.operadores o on o.uid=pc.created_by where pc.run_id=r.id and pc.deleted_at is null) z),'[]'::jsonb) as contributors,(manager or r.created_by=auth.uid()) as can_manage,true as can_continue,(r.closed_at is not null and (manager or r.created_by=auth.uid()) and now()<r.started_at+interval '24 hours' and not exists(select 1 from public.production_station_reports sr where sr.live_run_id=r.id and sr.status<>'draft')) as can_reopen,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by (c.recorded_at=r.closed_at) desc nulls last,c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null  and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('reporter_name',(select o.nombre from public.operadores o where o.uid=c.created_by)) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null  and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_report_fixed_breaks(p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare zone text:=coalesce(nullif(p_report->>'timezone',''),'America/Los_Angeles');a timestamp;b timestamp;x timestamp;y timestamp;e jsonb;events jsonb:='[]';merged jsonb; lr public.production_live_runs;run_id uuid;
begin
 if coalesce(p_report->>'start_time','')='' or coalesce(p_report->>'end_time','')='' or coalesce(p_report->>'production_date','')='' then return p_report;end if;
 a:=(p_report->>'production_date')::date+(p_report->>'start_time')::time;
 b:=(p_report->>'production_date')::date+(p_report->>'end_time')::time+case when coalesce((p_report->>'ends_next_day')::boolean,false) then interval '1 day' else interval '0' end;
 if b<=a or b-a>interval '24 hours' then raise exception 'pr_time_invalid';end if;
 run_id:=nullif(p_report->>'live_run_id','')::uuid;
 if run_id is null then select live_run_id into run_id from public.production_station_reports where id=nullif(p_report->>'id','')::uuid;end if;
 if run_id is not null then
  select * into lr from public.production_live_runs where id=run_id;
  if jsonb_array_length(lr.closed_intervals)>0 and ((a at time zone zone)<>date_trunc('minute',lr.started_at) or exists(select 1 from jsonb_array_elements(lr.closed_intervals) where (value->>'end_at')::timestamptz>=(b at time zone zone))) then raise exception 'pr_time_invalid';end if;
 end if;
 for e in select value from jsonb_array_elements(coalesce(p_report->'downtime_events','[]')) where value->>'type' is distinct from 'inactive' loop
  if e?'start_time' and e?'end_time' then
   x:=a::date+(e->>'start_time')::time;y:=a::date+(e->>'end_time')::time;
   if x<a then x:=x+interval '1 day';end if;if y<=x then y:=y+interval '1 day';end if;
   e:=e||jsonb_build_object('start_at',x at time zone zone,'end_at',y at time zone zone);
  end if;events:=events||jsonb_build_array(e);
 end loop;
 events:=events||rls_internal.production_inactive_events(coalesce(lr.closed_intervals,'[]'));
 merged:=rls_internal.production_merge_fixed_events(a at time zone zone,b at time zone zone,events,zone);
 select coalesce(jsonb_agg(entry.value||case when entry.value?'start_at' and entry.value?'end_at' then jsonb_build_object('start_time',to_char((entry.value->>'start_at')::timestamptz at time zone zone,'HH24:MI'),'end_time',to_char((entry.value->>'end_at')::timestamptz at time zone zone,'HH24:MI'),'minutes',extract(epoch from (entry.value->>'end_at')::timestamptz-(entry.value->>'start_at')::timestamptz)/60) else '{}'::jsonb end),'[]') into events from jsonb_array_elements(merged) as entry(value);
 return p_report||jsonb_build_object('downtime_events',events);
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_duration_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result_id uuid;events jsonb;d jsonb;minutes numeric;total_stop numeric:=0;break_stop numeric:=0;breaks integer:=0;reason text:='';elapsed numeric;payload jsonb:=p_data;capacity integer;pallets integer:=0;profile public.inventory_bom_packaging%rowtype;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in ('save','submit') and p_data ? 'downtime_events' then
  perform pg_advisory_xact_lock(hashtextextended('station-report:'||(p_data->>'id'),0));
  events:=p_data->'downtime_events';
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>1000 then raise exception 'pr_downtime_invalid';end if;
  for d in select value from jsonb_array_elements(events) loop
   if d->>'type' is null or d->>'type' not in ('break','lunch','maintenance','breakdown','inactive') then raise exception 'pr_downtime_invalid';end if;
   minutes:=nullif(d->>'minutes','')::numeric;
   if minutes is null or minutes<=0 or minutes::text in ('NaN','Infinity','-Infinity') then raise exception 'pr_downtime_invalid';end if;
   total_stop:=total_stop+minutes;
   if d->>'type' in ('break','lunch') then break_stop:=break_stop+minutes;breaks:=breaks+1;
   else reason:=concat_ws('; ',nullif(reason,''),d->>'type'||case when coalesce(d->>'note','')<>'' then ': '||(d->>'note') else '' end);end if;
  end loop;
  elapsed:=extract(epoch from ((p_data->>'end_time')::time-(p_data->>'start_time')::time))/60+case when coalesce((p_data->>'ends_next_day')::boolean,false) then 1440 else 0 end;
  if elapsed is null or elapsed<=0 or elapsed>1440 or total_stop>elapsed then raise exception 'pr_time_invalid';end if;
  if coalesce((p_data->>'full_boxes')::integer,0)>0 then
   select p.* into profile from public.inventory_bom_packaging p join public.inventory_boms b on b.id=p.bom_id
    where b.finished_item_id=(p_data->>'item_id')::uuid and b.active and not b.archived and p.packaging_type=p_data->>'packaging_type' for share of b,p;
   if found and exists(select 1 from public.inventory_bom_packaging_lines l where l.bom_id=profile.bom_id and l.packaging_type=profile.packaging_type and l.basis='pallet') then
    capacity:=profile.boxes_per_pallet;
    if capacity is null or capacity<=0 then raise exception 'pr_pallet_capacity';end if;
    pallets:=ceil((p_data->>'full_boxes')::numeric/capacity)::integer;
   end if;
  end if;
  payload:=p_data||jsonb_build_object('machine_minutes',elapsed-total_stop,'downtime_minutes',total_stop-break_stop,'break_count',breaks,'break_minutes',break_stop,'downtime_reason',reason,'pallets',pallets);
 end if;
 result_id:=rls_internal.production_station_action_core(p_action,payload);
 if p_action in ('save','submit') and p_data ? 'downtime_events' then update public.production_station_reports set downtime_events=events where id=result_id;end if;
 return result_id;
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run uuid; result uuid; existing_draft uuid; lr public.production_live_runs;zone text;finish_at timestamptz;events jsonb;event jsonb;a timestamp;b timestamp;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in('save','submit') then
  run:=nullif(p_data->>'live_run_id','')::uuid;
  if run is null then select live_run_id into run from public.production_station_reports where id=(p_data->>'id')::uuid;end if;
  if run is not null then
   select * into lr from public.production_live_runs where id=run for update;
   if lr.id is null or lr.station_code is distinct from p_data->>'station_code' or lr.item_id is distinct from (p_data->>'item_id')::uuid or lr.deleted_at is not null then raise exception 'pr_invalid';end if;
   select id into existing_draft from public.production_station_reports where live_run_id=run and report_mode='production' and status='draft';
   if existing_draft is not null then p_data:=jsonb_set(p_data,'{id}',to_jsonb(existing_draft));end if;
   if p_action='submit' and p_data->>'report_mode'='production' and lr.closed_at is null then
    zone:=nullif(p_data->>'timezone','');
    if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
    a:=(p_data->>'production_date')::date+(p_data->>'start_time')::time;
    b:=(p_data->>'production_date')::date+(p_data->>'end_time')::time+case when coalesce((p_data->>'ends_next_day')::boolean,false) then interval '1 day' else interval '0' end;
    if date_trunc('minute',a at time zone zone)<>date_trunc('minute',lr.started_at) then raise exception 'pr_time_invalid';end if;
    finish_at:=b at time zone zone;events:='[]'::jsonb;
    for event in select value from jsonb_array_elements(coalesce(p_data->'downtime_events','[]'::jsonb)) loop
     if not(event ? 'start_time' and event ? 'end_time') then events:=lr.downtime_events;exit;end if;
     a:=(p_data->>'production_date')::date+(event->>'start_time')::time;
     b:=(p_data->>'production_date')::date+(event->>'end_time')::time;
     if a < (lr.started_at at time zone zone) then a:=a+interval '1 day';end if;
     if b < (lr.started_at at time zone zone) then b:=b+interval '1 day';end if;
     events:=events||jsonb_build_array(jsonb_build_object('type',event->>'type','note',coalesce(event->>'note',''),'start_at',a at time zone zone,'end_at',b at time zone zone));
    end loop;
    perform rls_internal.production_live_action_progress_base('finish',jsonb_build_object('id',gen_random_uuid(),'run_id',run,'quantity',p_data->'machine_quantity','finished_at',finish_at,'downtime_events',events));
   end if;
  end if;
 end if;
 result:=rls_internal.production_station_action_supply_base(p_action,p_data);
 if p_action in('save','submit') then update public.production_station_reports set live_run_id=run,progress_draft=false where id=result;end if;
 return result;
end $function$
;
-- Keep stored totals consistent: the closed interval is outside production time.
create or replace function rls_internal.production_report_inactive_totals() returns trigger language plpgsql security definer set search_path='' as $$
declare inactive numeric;wall numeric;stops numeric;breaks numeric;
begin
 select coalesce(sum((value->>'minutes')::numeric) filter(where value->>'type'='inactive'),0),coalesce(sum((value->>'minutes')::numeric),0),coalesce(sum((value->>'minutes')::numeric) filter(where value->>'type' in ('break','lunch')),0) into inactive,stops,breaks from jsonb_array_elements(new.downtime_events);
 if inactive>0 then
  wall:=extract(epoch from new.end_time-new.start_time)/60+case when new.ends_next_day then 1440 else 0 end;
  new.elapsed_minutes:=wall-inactive;new.machine_minutes:=greatest(0,wall-stops);new.downtime_minutes:=greatest(0,stops-breaks-inactive);new.break_minutes:=breaks;
 end if;return new;
end $$;
create trigger production_report_inactive_totals before insert or update on public.production_station_reports for each row execute function rls_internal.production_report_inactive_totals();
revoke all on function rls_internal.production_inactive_events(jsonb),rls_internal.production_report_inactive_totals() from public,anon,authenticated;
notify pgrst,'reload schema';
