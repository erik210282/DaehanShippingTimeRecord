create table public.inventory_machine_bom_links(root_station_code text not null references public.inventory_workstations(code),dependency_station_code text not null references public.inventory_workstations(code),item_ids uuid[] not null default '{}',enabled boolean not null default true,updated_at timestamptz not null default clock_timestamp(),updated_by uuid references auth.users(id),primary key(root_station_code,dependency_station_code),check(root_station_code<>dependency_station_code));
alter table public.inventory_machine_bom_links enable row level security;
create policy machine_bom_read on public.inventory_machine_bom_links for select to authenticated using(rls_internal.catalog_access() or rls_internal.inventory_access('production'));
revoke all on public.inventory_machine_bom_links from public,anon,authenticated;
grant select on public.inventory_machine_bom_links to authenticated;
create trigger machine_bom_changed after insert or update or delete on public.inventory_machine_bom_links for each statement execute function rls_internal.production_progress_notify();
create table rls_internal.production_plan_changes(id uuid primary key,actor uuid not null,payload jsonb not null,before_data jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table rls_internal.production_plan_changes enable row level security;
create policy plan_changes_private on rls_internal.production_plan_changes for all to authenticated using(false) with check(false);
revoke all on rls_internal.production_plan_changes from public,anon,authenticated;
create or replace function rls_internal.production_machine_bom_snapshot() returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not(rls_internal.catalog_access() or rls_internal.inventory_access('production')) then raise exception 'pr_forbidden';end if;
 return jsonb_build_object('can_manage',rls_internal.catalog_access(true),'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'part_number',part_number,'part_name',part_name,'description',description,'category',category,'active',active)) from public.inventory_items),'[]'),'stations',coalesce((select jsonb_agg(to_jsonb(w) order by code) from public.inventory_workstations w),'[]'),'boms',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('inventory_bom_lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.inventory_bom_lines l where l.bom_id=b.id),'[]'))) from public.inventory_boms b where b.active and not b.archived),'[]'),'links',coalesce((select jsonb_agg(to_jsonb(l)) from public.inventory_machine_bom_links l),'[]'));
end $fn$;
create or replace function rls_internal.production_machine_bom_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare root text:=p_data->>'root_station_code';dep text:=p_data->>'dependency_station_code';ids uuid[];old public.inventory_machine_bom_links;entry uuid;
begin
 if auth.uid() is null or not rls_internal.catalog_access(true) then raise exception 'pr_forbidden';end if;
 if p_action not in('save','delete') or root is null or dep is null or root=dep or not exists(select 1 from public.inventory_workstations where code=root) or not exists(select 1 from public.inventory_workstations where code=dep) then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('machine-bom:'||root,0));select * into old from public.inventory_machine_bom_links where root_station_code=root and dependency_station_code=dep for update;
 if old.root_station_code is not null and nullif(p_data->>'version','')::timestamptz is distinct from old.updated_at then raise exception 'mp_changed';end if;
 if p_action='delete' then delete from public.inventory_machine_bom_links where root_station_code=root and dependency_station_code=dep;return jsonb_build_object('saved',true);end if;
 if jsonb_typeof(p_data->'item_ids') is distinct from 'array' then raise exception 'pr_invalid';end if;
 select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(p_data->'item_ids');
 if cardinality(ids)>30 or (coalesce((p_data->>'enabled')::boolean,true) and cardinality(ids)=0) then raise exception 'pr_invalid';end if;
 foreach entry in array ids loop
  if not exists(select 1 from public.inventory_items i join public.inventory_workstations w on w.code=dep where i.id=entry and i.active and i.category in('FG','SEMI') and exists(select 1 from jsonb_array_elements(w.materials)m where m->>'item_id'=entry::text or coalesce(m->'item_ids','[]') ? entry::text or upper(m->>'client_part_number')=upper(i.part_number))) then raise exception 'pr_output_required';end if;
 end loop;
 insert into public.inventory_machine_bom_links(root_station_code,dependency_station_code,item_ids,enabled,updated_by) values(root,dep,ids,coalesce((p_data->>'enabled')::boolean,true),auth.uid()) on conflict(root_station_code,dependency_station_code) do update set item_ids=excluded.item_ids,enabled=excluded.enabled,updated_at=clock_timestamp(),updated_by=auth.uid();return jsonb_build_object('saved',true);
end $fn$;
create or replace function rls_internal.production_update_run_plan(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid();request uuid:=(p_data->>'id')::uuid;entry jsonb;r public.production_live_runs;hours numeric;before_rows jsonb:='[]';old rls_internal.production_plan_changes;station text;session uuid;
begin
 if actor is null or not rls_internal.role_activity_access('production','shifts') or not public.inventory_access('production') or not(public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=actor and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
 if request is null or jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 or (select count(distinct value->>'run_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('run-plan:'||request,0));select * into old from rls_internal.production_plan_changes where id=request;if old.id is not null then if old.actor<>actor or old.payload<>p_data then raise exception 'pr_invalid';end if;return jsonb_build_object('saved',true);end if;
 for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'run_id' loop
  select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
  if r.id is null or r.deleted_at is not null or r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if nullif(entry->>'version','')::timestamptz is distinct from coalesce(r.updated_at,r.created_at) then raise exception 'mp_changed';end if;
  if station is null then station:=r.station_code;session:=r.session_id;elsif station<>r.station_code or session is distinct from r.session_id then raise exception 'pr_invalid';end if;
  hours:=nullif(entry->>'planned_hours','')::numeric;if hours is null or hours<0.5 or hours>24 or hours::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
  before_rows:=before_rows||jsonb_build_array(to_jsonb(r));update public.production_live_runs set planned_hours=hours,updated_at=clock_timestamp(),updated_by=actor where id=r.id;
 end loop;
 insert into rls_internal.production_plan_changes(id,actor,payload,before_data) values(request,actor,p_data,before_rows);update public.catalog_updates set version=version+1 where id=1;return jsonb_build_object('saved',true);
end $fn$;
revoke all on function rls_internal.production_machine_bom_snapshot() from public,anon;
grant execute on function rls_internal.production_machine_bom_snapshot() to authenticated;
create or replace function public.production_machine_bom_snapshot() returns jsonb language sql set search_path='' as $fn$ select rls_internal.production_machine_bom_snapshot() $fn$;
revoke all on function public.production_machine_bom_snapshot() from public,anon;grant execute on function public.production_machine_bom_snapshot() to authenticated;
revoke all on function rls_internal.production_machine_bom_action(p_action text,p_data jsonb) from public,anon;
grant execute on function rls_internal.production_machine_bom_action(p_action text,p_data jsonb) to authenticated;
create or replace function public.production_machine_bom_action(p_action text,p_data jsonb) returns jsonb language sql set search_path='' as $fn$ select rls_internal.production_machine_bom_action(p_action,p_data) $fn$;
revoke all on function public.production_machine_bom_action(p_action text,p_data jsonb) from public,anon;grant execute on function public.production_machine_bom_action(p_action text,p_data jsonb) to authenticated;
revoke all on function rls_internal.production_update_run_plan(p_data jsonb) from public,anon;
grant execute on function rls_internal.production_update_run_plan(p_data jsonb) to authenticated;
create or replace function public.production_update_run_plan(p_data jsonb) returns jsonb language sql set search_path='' as $fn$ select rls_internal.production_update_run_plan(p_data) $fn$;
revoke all on function public.production_update_run_plan(p_data jsonb) from public,anon;grant execute on function public.production_update_run_plan(p_data jsonb) to authenticated;
CREATE OR REPLACE FUNCTION rls_internal.production_shift_plan(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 uid uuid:=auth.uid(); request uuid:=(p_data->>'id')::uuid;
 old_request rls_internal.production_shift_plan_requests;
 prior public.production_shift_schedule;
 entry jsonb; canonical jsonb; start_at timestamptz; planned numeric;
 child uuid; results jsonb:='[]'::jsonb; response jsonb;
begin
 if uid is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','shifts') or not (
 public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-schedule',0));
 select * into old_request from rls_internal.production_shift_plan_requests where id=request;
 if old_request.id is not null then
  if old_request.created_by<>uid or old_request.payload<>p_data then raise exception 'pr_invalid';end if;
  return old_request.result;
 end if;
 if jsonb_typeof(p_data->'stations') is distinct from 'array' then raise exception 'pr_invalid';end if;
 if jsonb_array_length(p_data->'stations') not between 1 and 30 or
 (select count(distinct value->>'station_code') from jsonb_array_elements(p_data->'stations'))<>jsonb_array_length(p_data->'stations') then raise exception 'pr_invalid';end if;
 if nullif(p_data->>'schedule_id','') is not null then
  select * into prior from public.production_shift_schedule where id=(p_data->>'schedule_id')::uuid for update;
  if prior.id is null or prior.status not in ('scheduled','failed') or prior.updated_at is distinct from (p_data->>'schedule_version')::timestamptz then raise exception 'pr_invalid';end if;
  perform rls_internal.production_schedule_action('cancel',jsonb_build_object('id',prior.id));
 end if;
 for entry in select value from jsonb_array_elements(p_data->'stations') order by value->>'station_code' loop
  child:=md5(request::text||':'||(entry->>'station_code'))::uuid;
  start_at:=coalesce(nullif(entry->>'started_at',''),p_data->>'started_at')::timestamptz;
  planned:=coalesce(nullif(entry->>'planned_hours',''),nullif(p_data->>'planned_hours',''),p_data->>'shift_hours')::numeric;
  canonical:=jsonb_build_object('id',child,'started_at',start_at,'shift_hours',p_data->'shift_hours','planned_hours',planned,
   'stations',jsonb_build_array(jsonb_build_object('station_code',entry->>'station_code','item_ids',entry->'item_ids','product_hours',coalesce(entry->'product_hours','{}'::jsonb))));
  if start_at>clock_timestamp() then
   perform rls_internal.production_schedule_action('save',canonical);
   results:=results||jsonb_build_array(jsonb_build_object('id',child,'status','scheduled'));
  else
   if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st
    where s.status='scheduled' and st->>'station_code'=entry->>'station_code'
    and s.started_at<start_at+(planned+0.5)*interval '1 hour'
    and s.started_at+(coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)+0.5)*interval '1 hour'>start_at) then raise exception 'ps_schedule_overlap';end if;
   perform rls_internal.production_supply_action('start',canonical);
   results:=results||jsonb_build_array(jsonb_build_object('id',child,'status','started'));
  end if;
 end loop;
 response:=jsonb_build_object('saved',true,'machines',results);
 insert into rls_internal.production_shift_plan_requests(id,created_by,payload,result) values(request,uid,p_data,response);
 return response;
end $function$;
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
  if not exists(select 1 from public.inventory_items where id=ingredient and category in ('RAW','SEMI') and active) then raise exception 'pr_item_required';end if;
  if not exists(select 1 from rls_internal.production_station_raw_ids(station) allowed where allowed.item_id=ingredient) then raise exception 'ps_station_material_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('supply-station:'||station,0));
  -- First allocation is a physical starting balance; prior production must not be deducted from it.
  if not exists(select 1 from public.production_material_loads where station_code=station and item_id=ingredient and deleted_at is null) and not exists(select 1 from public.production_material_usages where station_code=station and item_id=ingredient) then
   delete from public.production_material_baselines where station_code=station and item_id=ingredient;

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
    planned:=coalesce(nullif(entry->'product_hours'->>ingredient::text,'')::numeric,nullif(p_data->>'planned_hours','')::numeric,hours);
    if planned is null or planned<0.5 or planned>24 or planned::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
    if not exists(select 1 from public.inventory_items where id=ingredient and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
    select * into goal from public.production_targets where item_id=ingredient and deleted_at is null;
    -- No target means pending compliance; preserve actual production independently.
    qty:=case when hours=8 then goal.target_8h else goal.target_10h end;
    insert into public.production_live_runs(id,session_id,shift_start_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target,planned_hours)
    values(gen_random_uuid(),session,request,station,ingredient,start_at,uid,qty/(case when hours=10 then 9.3 else 7.5 end),2,coalesce(goal.warning_percent,90),coalesce(goal.critical_percent,75),hours,qty,planned);
   end loop;
  end loop;
  return jsonb_build_object('saved',true);
 else raise exception 'pr_invalid';end if;
end $function$;
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
   if entry->'product_hours'->>item is not null and (nullif(entry->'product_hours'->>item,'')::numeric is null or (entry->'product_hours'->>item)::numeric<0.5 or (entry->'product_hours'->>item)::numeric>24 or (entry->'product_hours'->>item)::numeric::text in('NaN','Infinity','-Infinity')) then raise exception 'pl_start_invalid';end if;
   if not exists(select 1 from public.inventory_items where id=item::uuid and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
   -- Scheduled starts also allow products with a target still pending.
  end loop;
  if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st
   where s.id<>request and s.status='scheduled' and st->>'station_code'=entry->>'station_code'
   and s.started_at<start_at+((planned+0.5)*interval '1 hour') and s.started_at+((coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)+0.5)*interval '1 hour')>start_at) then raise exception 'ps_schedule_overlap';end if;
 end loop;
 insert into public.production_shift_schedule(id,payload,started_at,created_by) values(request,p_data,start_at,uid)
 on conflict(id) do update set payload=excluded.payload,started_at=excluded.started_at,created_by=excluded.created_by,status='scheduled',error_code=null,executed_at=null,updated_at=now();
 return jsonb_build_object('saved',true);
end $function$;