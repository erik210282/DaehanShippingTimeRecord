-- Station RAW choices come from explicit assignments, active product BOMs,
-- running products, and direct RAW children of legacy ERP workstation operations.
-- Preserve reference hierarchy: a foaming operation must not inherit RAW from
-- a different operation or an earlier forming step.
create or replace function rls_internal.production_station_raw_ids(p_station text)
returns table(item_id uuid) language sql stable set search_path='' as $raw$
 with station as (
  select m from public.inventory_workstations w cross join lateral jsonb_array_elements(w.materials) m
  where w.code=p_station and w.active
 ), assigned as (
  select i.id,i.category from station s join public.inventory_items i on
   i.id::text=s.m->>'item_id' or coalesce(s.m->'item_ids','[]'::jsonb) ? i.id::text
   or upper(i.part_number)=upper(s.m->>'client_part_number')
   or upper(i.part_number)=upper(s.m->>'erp_material')
  where i.active
 ), products as (
  select id from assigned where category in('FG','SEMI')
  union select item_id from public.production_live_runs where station_code=p_station and closed_at is null and deleted_at is null
 ), legacy_parent as (
  select r.* from public.inventory_reference_rows r join station s on upper(r.part_number)=upper(s.m->>'erp_material')
  where r.kind='bom' and r.details->>'level' ~ '^[0-9]+$'
 ), ids as (
  select id from assigned where category='RAW'
  union
  select bl.ingredient_id from products p join public.inventory_boms b on b.finished_item_id=p.id and b.active and not b.archived
   join public.inventory_bom_lines bl on bl.bom_id=b.id
  union
  select i.id from legacy_parent p
   join public.inventory_reference_rows r on r.batch_key=p.batch_key and r.source_sheet=p.source_sheet
    and r.kind='bom' and r.fg_part_number is not distinct from p.fg_part_number and r.source_row>p.source_row
    and r.details->>'level' ~ '^[0-9]+$' and (r.details->>'level')::integer=(p.details->>'level')::integer+1
    and not exists(select 1 from public.inventory_reference_rows boundary where boundary.batch_key=p.batch_key
     and boundary.source_sheet=p.source_sheet and boundary.kind='bom' and boundary.source_row>p.source_row and boundary.source_row<r.source_row
     and boundary.fg_part_number is not distinct from p.fg_part_number and boundary.details->>'level' ~ '^[0-9]+$'
     and (boundary.details->>'level')::integer<=(p.details->>'level')::integer)
   join public.inventory_items i on upper(i.part_number)=upper(r.part_number)
 )
 select distinct i.id from ids join public.inventory_items i on i.id=ids.id where i.active and i.category='RAW';
$raw$;
revoke all on function rls_internal.production_station_raw_ids(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION rls_internal.production_supply_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); leader boolean; request uuid:=(p_data->>'id')::uuid; station text; ingredient uuid; qty numeric; minutes numeric; old public.production_shift_starts; entry jsonb; product jsonb; start_at timestamptz; hours integer; session uuid; goal public.production_targets; baseline jsonb; running record;
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
  start_at:=nullif(p_data->>'started_at','')::timestamptz;hours:=nullif(p_data->>'shift_hours','')::integer;
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
    insert into public.production_live_runs(id,session_id,shift_start_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
    values(gen_random_uuid(),session,request,station,ingredient,start_at,uid,qty/(case when hours=10 then 9.3 else 7.5 end),2,goal.warning_percent,goal.critical_percent,hours,qty);
   end loop;
  end loop;
  return jsonb_build_object('saved',true);
 else raise exception 'pr_invalid';end if;
end $function$

;
CREATE OR REPLACE FUNCTION rls_internal.production_supply_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return jsonb_build_object(
 'station_materials',coalesce((select jsonb_agg(jsonb_build_object('station_code',w.code,'item_id',m.item_id)) from public.inventory_workstations w cross join lateral rls_internal.production_station_raw_ids(w.code) m where w.active),'[]'::jsonb),
 'materials',coalesce((select jsonb_agg(to_jsonb(m)) from (
  select l.station_code,l.item_id,sum(l.quantity) as loaded_quantity,min(l.created_at) as tracked_at,
  15::numeric as alert_minutes,
  coalesce((select sum(u.quantity) from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id),0) as confirmed_consumption,
  0::numeric as confirmed_baseline
  from public.production_material_loads l group by l.station_code,l.item_id
 ) m),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select lr.*,coalesce(sr.machine_quantity,0) as posted_quantity,
   coalesce((select jsonb_agg(jsonb_build_object('item_id',bl.ingredient_id,'per_unit',bl.quantity_per_unit*(1+bl.waste_rate))) from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id join public.inventory_items i on i.id=bl.ingredient_id and i.category='RAW' where ib.finished_item_id=lr.item_id and ib.active and not ib.archived),'[]'::jsonb) as raw_recipe
  from public.production_live_runs lr left join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production'
  where lr.deleted_at is null and (lr.closed_at is null or sr.id is null)
 ) r),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(to_jsonb(b)) from public.production_material_baselines b),'[]'::jsonb),
 'wip',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select sr.station_code,sr.item_id,sum(case when sr.report_mode='packing' then -sr.packed_quantity else sr.good_quantity-sr.packed_quantity end) quantity
  from public.production_station_reports sr where sr.status='posted' and not exists(select 1 from public.production_station_consumptions c where c.report_id=sr.id and c.source='repack') group by sr.station_code,sr.item_id
 ) w where w.quantity<>0),'[]'::jsonb),
 'loads',coalesce((select jsonb_agg(to_jsonb(l)) from (select ml.*,o.nombre as reporter_name from public.production_material_loads ml left join public.operadores o on o.uid=ml.created_by order by ml.created_at desc limit 100) l),'[]'::jsonb)
 );
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
  if closing and v_now<=r.started_at then raise exception 'pl_finish_invalid';end if;
  if v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
 end if;
 if p_data ? 'downtime_events' then
  events:=p_data->'downtime_events';
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>1000 then raise exception 'pr_downtime_invalid';end if;
  for event in select value from jsonb_array_elements(events) loop
   if event->>'type' is null or event->>'type' not in ('break','lunch','maintenance','breakdown') then raise exception 'pr_downtime_invalid';end if;
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
CREATE OR REPLACE FUNCTION rls_internal.production_live_recalculate(p_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.production_live_runs;c public.production_checkpoints;
begin
 select * into r from public.production_live_runs where id=p_run for update;
 if exists(select 1 from (select quantity,lag(quantity) over(order by recorded_at,id) previous from public.production_checkpoints where run_id=p_run and deleted_at is null and (r.closed_at is null or recorded_at<=r.closed_at))x where quantity<previous) then raise exception 'pl_quantity_invalid';end if;
 if exists(select 1 from public.production_checkpoints where run_id=p_run and deleted_at is null and recorded_at<=r.started_at) then raise exception 'pl_start_invalid';end if;
 if r.closed_at is not null and exists(select 1 from public.production_checkpoints late where late.run_id=p_run and late.deleted_at is null and late.quantity>(select final.quantity from public.production_checkpoints final where final.run_id=p_run and final.deleted_at is null and final.recorded_at=r.closed_at limit 1)) then raise exception 'pl_quantity_invalid';end if;
 update public.production_checkpoints cp set expected_quantity=greatest(0.000001,r.shift_target/(case when r.shift_hours=10 then 9.3 else 7.5 end)*greatest(0,extract(epoch from(least(cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-r.started_at))/3600-
 coalesce((select sum(greatest(0,extract(epoch from(least((d->>'end_at')::timestamptz,cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-greatest((d->>'start_at')::timestamptz,r.started_at))))) from jsonb_array_elements(r.downtime_events)d),0)/3600))
 where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set attainment=quantity*100/expected_quantity where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set performance=case when attainment<r.critical_percent then 'critical' when attainment<r.warning_percent then 'warning' else 'on_track' end where run_id=p_run and deleted_at is null;
 select * into c from public.production_checkpoints where run_id=p_run and deleted_at is null and (r.closed_at is null or recorded_at<=r.closed_at) order by recorded_at desc,id desc limit 1;
 update public.production_live_runs set latest_quantity=coalesce(c.quantity,0),latest_at=c.recorded_at where id=p_run;
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
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '48 hours' then raise exception 'pr_invalid';end if;
 manager:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,coalesce((select jsonb_agg(to_jsonb(z)) from (select distinct pc.created_by as uid,o.nombre as name from public.production_checkpoints pc left join public.operadores o on o.uid=pc.created_by where pc.run_id=r.id and pc.deleted_at is null) z),'[]'::jsonb) as contributors,(manager or r.created_by=auth.uid()) as can_manage,true as can_continue,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by (c.recorded_at=r.closed_at) desc nulls last,c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null  and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('reporter_name',(select o.nombre from public.operadores o where o.uid=c.created_by)) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null  and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$

;
notify pgrst,'reload schema';
