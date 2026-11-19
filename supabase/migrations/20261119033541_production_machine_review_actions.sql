-- Review all products of one machine session atomically and restrict manual loads to RAW.
CREATE OR REPLACE FUNCTION rls_internal.production_station_action(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb;first_row jsonb;result uuid;review_session_id uuid;this_session uuid;draft public.production_station_reports; candidate public.production_station_reports;chosen_group uuid;ids uuid[]:=array[]::uuid[];
begin
 if auth.uid() is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','records') then raise exception 'pr_forbidden';end if;
 if p_action in('post','return') and p_data?'products' then
  if not public.inventory_access('production',true) then raise exception 'pr_forbidden';end if;
  if jsonb_typeof(p_data->'products') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(p_data->'products') not between 1 and 1000
   or (select count(distinct value->>'id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  select * into draft from public.production_station_reports where id=(p_data->'products'->0->>'id')::uuid;
  if draft.id is null then raise exception 'pr_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('daily-machine:'||draft.station_code,0));
  review_session_id:=coalesce(draft.machine_session_id,(select r.session_id from public.production_live_runs r where r.id=draft.live_run_id),draft.capture_group_id);
  -- Authorize and lock the whole selection before posting or returning any product.
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   select * into candidate from public.production_station_reports where id=(entry->>'id')::uuid for update;
   if candidate.id is null or candidate.station_code<>draft.station_code or candidate.production_date<>draft.production_date then raise exception 'pr_invalid';end if;
   this_session:=coalesce(candidate.machine_session_id,(select r.session_id from public.production_live_runs r where r.id=candidate.live_run_id),candidate.capture_group_id);
   if review_session_id is distinct from this_session then raise exception 'pr_invalid';end if;
   if review_session_id is null and row(candidate.start_time,candidate.end_time,candidate.ends_next_day,candidate.people,candidate.staff_names,candidate.turns,candidate.report_mode,candidate.downtime_events,candidate.break_work)
     is distinct from row(draft.start_time,draft.end_time,draft.ends_next_day,draft.people,draft.staff_names,draft.turns,draft.report_mode,draft.downtime_events,draft.break_work) then raise exception 'pr_invalid';end if;
   if p_action='post' and candidate.status not in('submitted','posted') or p_action='return' and candidate.status not in('submitted','draft') then raise exception 'pr_locked';end if;
  end loop;
  if exists(
   select 1 from public.production_station_reports r left join public.production_live_runs lr on lr.id=r.live_run_id
   where r.station_code=draft.station_code and r.production_date=draft.production_date
    and coalesce(r.machine_session_id,lr.session_id,r.capture_group_id) is not distinct from review_session_id
    and (review_session_id is not null or row(r.start_time,r.end_time,r.ends_next_day,r.people,r.staff_names,r.turns,r.report_mode,r.downtime_events,r.break_work)
      is not distinct from row(draft.start_time,draft.end_time,draft.ends_next_day,draft.people,draft.staff_names,draft.turns,draft.report_mode,draft.downtime_events,draft.break_work))
    and not exists(select 1 from jsonb_array_elements(p_data->'products') selected where selected->>'id'=r.id::text)
  ) then raise exception 'pr_locked';end if;
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   if p_action='return' and exists(select 1 from public.production_station_reports where id=(entry->>'id')::uuid and status='draft') then continue;end if;
   perform rls_internal.production_daily_single(p_action,entry,null);
  end loop;
  return draft.id;
 end if;
 if p_action in('save','submit') and p_data?'products' then
  if jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 then raise exception 'pr_invalid';end if;
  first_row:=p_data->'products'->0;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') or (select count(distinct value->>'id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  chosen_group:=coalesce(nullif(p_data->>'capture_group_id','')::uuid,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended('daily-machine:'||(first_row->>'station_code'),0));
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   if entry->>'station_code' is distinct from first_row->>'station_code' or entry->>'production_date' is distinct from first_row->>'production_date' then raise exception 'pr_invalid';end if;
   if nullif(entry->>'live_run_id','') is not null then
    select coalesce(r.session_id,r.id) into this_session from public.production_live_runs r where r.id=(entry->>'live_run_id')::uuid and r.deleted_at is null;
    if this_session is null or review_session_id is not null and review_session_id<>this_session then raise exception 'pr_invalid';end if;
    review_session_id:=this_session;
   end if;
  end loop;
  review_session_id:=coalesce(review_session_id,nullif(p_data->>'machine_session_id','')::uuid,chosen_group);

  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   result:=rls_internal.production_daily_single(p_action,entry-'products',review_session_id);
   update public.production_station_reports set machine_session_id=review_session_id,capture_group_id=coalesce(capture_group_id,chosen_group) where id=result;
  end loop;
  return chosen_group;
 end if;
 return rls_internal.production_daily_single(p_action,p_data,null);
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_supply_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); leader boolean; request uuid:=(p_data->>'id')::uuid; station text; ingredient uuid; qty numeric; minutes numeric; old public.production_shift_starts; entry jsonb; product jsonb; start_at timestamptz; hours integer; planned numeric; session uuid; goal public.production_targets; running record;
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
  if not exists(select 1 from public.production_material_loads where station_code=station and item_id=ingredient and deleted_at is null) and not exists(select 1 from public.production_material_usages where station_code=station and item_id=ingredient) then
   delete from public.production_material_baselines where station_code=station and item_id=ingredient;

   for running in select r.* from public.production_live_runs r where r.station_code=station and r.deleted_at is null and r.closed_at is null and exists(select 1 from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id where ib.finished_item_id=r.item_id and ib.active and not ib.archived and bl.ingredient_id=ingredient) order by r.id loop
    insert into public.production_material_baselines(station_code,item_id,run_id,quantity)
    values(station,ingredient,running.id,running.latest_quantity);
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
    planned:=coalesce(nullif(entry->'product_hours'->>ingredient::text,'')::numeric,nullif(p_data->>'planned_hours','')::numeric,hours);
    if planned is null or planned<0.5 or planned>24 or planned::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
    if not exists(select 1 from public.inventory_items where id=ingredient and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
    select * into goal from public.production_targets where item_id=ingredient and deleted_at is null;
    -- No target means pending compliance; preserve actual production independently.
    qty:=case when hours=8 then goal.target_8h else goal.target_10h end;
    insert into public.production_live_runs(id,review_session_id,shift_start_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target,planned_hours)
    values(gen_random_uuid(),session,request,station,ingredient,start_at,uid,qty/(case when hours=10 then 9.3 else 7.5 end),2,coalesce(goal.warning_percent,90),coalesce(goal.critical_percent,75),hours,qty,planned);
   end loop;
  end loop;
  return jsonb_build_object('saved',true);
 else raise exception 'pr_invalid';end if;
end $function$;

