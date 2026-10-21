alter table public.production_live_runs add column if not exists planned_hours numeric check(planned_hours>=0.5 and planned_hours<=24 and planned_hours::text not in('NaN','Infinity','-Infinity'));
CREATE OR REPLACE FUNCTION rls_internal.production_supply_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); leader boolean; request uuid:=(p_data->>'id')::uuid; station text; ingredient uuid; qty numeric; minutes numeric; old public.production_shift_starts; entry jsonb; product jsonb; start_at timestamptz; hours integer; planned numeric; session uuid; goal public.production_targets; baseline jsonb; running record;
begin
 if not (rls_internal.role_activity_access('production',case when p_action like 'load%' then 'materials' else 'shifts' end)) then raise exception 'ra_denied';end if;
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action='load-batch' then
  if jsonb_typeof(p_data->'entries') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(p_data->'entries') not between 1 and 30 then raise exception 'pr_invalid';end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_data->'entries'))<>jsonb_array_length(p_data->'entries') then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'entries') order by value->>'item_id' loop
   perform rls_internal.production_supply_action('load',entry);
  end loop;
  return jsonb_build_object('saved',true);
 end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-request:'||request,0));
 if p_action='load' then
  if exists(select 1 from public.production_material_loads where id=request and created_by=uid) then return jsonb_build_object('saved',true);end if;
  station:=p_data->>'station_code';ingredient:=(p_data->>'item_id')::uuid;
  qty:=nullif(p_data->>'quantity','')::numeric;minutes:=15;
  if qty is null or qty<=0 or qty>1000000000 or minutes is null or minutes not between 1 and 480 then raise exception 'ps_load_invalid';end if;
  if not exists(select 1 from public.inventory_workstations where code=station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=ingredient and category='RAW' and active) then raise exception 'pr_item_required';end if;
  if not exists(select 1 from rls_internal.production_station_raw_ids(station) allowed where allowed.item_id=ingredient) then raise exception 'ps_station_material_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('supply-station:'||station,0));
  -- First allocation is a physical starting balance; prior production must not be deducted from it.
  if not exists(select 1 from public.production_material_loads where station_code=station and item_id=ingredient) then

   for running in select r.* from public.production_live_runs r where r.station_code=station and r.deleted_at is null and r.closed_at is null and exists(select 1 from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id where ib.finished_item_id=r.item_id and ib.active and not ib.archived and bl.ingredient_id=ingredient) order by r.id loop
    select value into baseline from jsonb_array_elements(coalesce(p_data->'baselines','[]'::jsonb)) where value->>'run_id'=running.id::text;
    if baseline is null or coalesce(baseline->>'quantity','') !~ '^[0-9]{1,12}$' or (baseline->>'quantity')::numeric<running.latest_quantity then raise exception 'ps_load_invalid';end if;
    insert into public.production_material_baselines(station_code,item_id,run_id,quantity) values(station,ingredient,running.id,(baseline->>'quantity')::numeric);
   end loop;
  end if;
  insert into public.production_material_loads(id,station_code,item_id,quantity,alert_minutes,created_by)
   values(request,station,ingredient,qty,minutes,uid);
  return jsonb_build_object('saved',true);
 elsif p_action='start' then
  leader:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
  if not leader then raise exception 'pr_forbidden';end if;
  select * into old from public.production_shift_starts where id=request;
  if old.id is not null then
   if old.created_by<>uid or old.payload<>p_data then raise exception 'pr_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  start_at:=nullif(p_data->>'started_at','')::timestamptz;hours:=nullif(p_data->>'shift_hours','')::integer;planned:=coalesce(nullif(p_data->>'planned_hours','')::numeric,hours);if planned is null or planned<0.5 or planned>24 or planned::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
  if start_at is null or start_at>clock_timestamp() or start_at<clock_timestamp()-interval '24 hours' or hours is null or hours not in(8,10) then raise exception 'pl_start_invalid';end if;
  if jsonb_typeof(p_data->'stations') is distinct from 'array' or jsonb_array_length(p_data->'stations') not between 1 and 30 or (select count(distinct value->>'station_code') from jsonb_array_elements(p_data->'stations'))<>jsonb_array_length(p_data->'stations') then raise exception 'pr_invalid';end if;
  insert into public.production_shift_starts(id,payload,created_by) values(request,p_data,uid);
  for entry in select value from jsonb_array_elements(p_data->'stations') order by value->>'station_code' loop
   station:=entry->>'station_code';
   if not exists(select 1 from public.inventory_workstations where code=station and active) then raise exception 'pr_station_required';end if;
   perform pg_advisory_xact_lock(hashtextextended(station,1));
   if exists(select 1 from public.production_live_runs where station_code=station and deleted_at is null and closed_at is null) then raise exception 'pl_station_busy';end if;
   if jsonb_typeof(entry->'item_ids') is distinct from 'array' or jsonb_array_length(entry->'item_ids') not between 1 and 30 or (select count(distinct value) from jsonb_array_elements_text(entry->'item_ids'))<>jsonb_array_length(entry->'item_ids') then raise exception 'pr_invalid';end if;
   session:=gen_random_uuid();
   for product in select value from jsonb_array_elements(entry->'item_ids') loop
    ingredient:=(product#>>'{}')::uuid;
    if not exists(select 1 from public.inventory_items where id=ingredient and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
    select * into goal from public.production_targets where item_id=ingredient and deleted_at is null;
    if goal.item_id is null then raise exception 'pl_target_missing';end if;
    qty:=case when hours=8 then goal.target_8h else goal.target_10h end;
    insert into public.production_live_runs(id,session_id,shift_start_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target,planned_hours)
    values(gen_random_uuid(),session,request,station,ingredient,start_at,uid,qty/(case when hours=10 then 9.3 else 7.5 end),2,goal.warning_percent,goal.critical_percent,hours,qty,planned);
   end loop;
  end loop;
  return jsonb_build_object('saved',true);
 else raise exception 'pr_invalid';end if;
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_schedule_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); request uuid:=(p_data->>'id')::uuid; start_at timestamptz; hours integer; planned numeric; entry jsonb; item text; old public.production_shift_schedule;
begin
 if uid is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','shifts') or not (
 public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-schedule',0));
 select * into old from public.production_shift_schedule where id=request for update;
 if old.id is not null and old.status in ('started','cancelled') then raise exception 'pr_invalid';end if;
 if p_action='cancel' then
  if old.id is null then raise exception 'pr_invalid';end if;
  update public.production_shift_schedule set status='cancelled',updated_at=now() where id=request;
  return jsonb_build_object('saved',true);
 end if;
 if p_action<>'save' then raise exception 'pr_invalid';end if;
 start_at:=(p_data->>'started_at')::timestamptz;hours:=(p_data->>'shift_hours')::integer;planned:=coalesce(nullif(p_data->>'planned_hours','')::numeric,hours);if planned is null or planned<0.5 or planned>24 or planned::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
 if start_at is null or start_at<=clock_timestamp() or start_at>now()+interval '366 days' or hours is null or hours not in(8,10) then raise exception 'pl_start_invalid';end if;
 if jsonb_typeof(p_data->'stations') is distinct from 'array' then raise exception 'pr_invalid';end if;
 if jsonb_array_length(p_data->'stations') not between 1 and 30 or (select count(distinct value->>'station_code') from jsonb_array_elements(p_data->'stations'))<>jsonb_array_length(p_data->'stations') then raise exception 'pr_invalid';end if;
 for entry in select value from jsonb_array_elements(p_data->'stations') loop
  if not exists(select 1 from public.inventory_workstations where code=entry->>'station_code' and active) then raise exception 'pr_station_required';end if;
  if jsonb_typeof(entry->'item_ids') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(entry->'item_ids') not between 1 and 30 or (select count(distinct value) from jsonb_array_elements_text(entry->'item_ids'))<>jsonb_array_length(entry->'item_ids') then raise exception 'pr_invalid';end if;
  for item in select value from jsonb_array_elements_text(entry->'item_ids') loop
   if not exists(select 1 from public.inventory_items where id=item::uuid and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
   if not exists(select 1 from public.production_targets where item_id=item::uuid and deleted_at is null) then raise exception 'pl_target_missing';end if;
  end loop;
  if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st
   where s.id<>request and s.status='scheduled' and st->>'station_code'=entry->>'station_code'
   and s.started_at<start_at+(planned*interval '1 hour') and s.started_at+(coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)*interval '1 hour')>start_at) then raise exception 'ps_schedule_overlap';end if;
 end loop;
 insert into public.production_shift_schedule(id,payload,started_at,created_by) values(request,p_data,start_at,uid)
 on conflict(id) do update set payload=excluded.payload,started_at=excluded.started_at,created_by=excluded.created_by,status='scheduled',error_code=null,executed_at=null,updated_at=now();
 return jsonb_build_object('saved',true);
end $function$
;
