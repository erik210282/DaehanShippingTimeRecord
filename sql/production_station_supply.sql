
-- Loaded RAW stays part of global RAW inventory. This ledger only assigns it to a station.
create table public.production_material_loads (
 id uuid primary key, station_code text not null references public.inventory_workstations(code),
 item_id uuid not null references public.inventory_items(id), quantity numeric not null check(quantity>0),
 alert_minutes numeric not null check(alert_minutes between 1 and 480),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.production_material_loads enable row level security;
revoke all on public.production_material_loads from anon,authenticated;
create index production_material_station_item on public.production_material_loads(station_code,item_id);
create table public.production_shift_starts (
 id uuid primary key, payload jsonb not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.production_shift_starts enable row level security;
revoke all on public.production_shift_starts from anon,authenticated;
alter table public.production_live_runs add column shift_start_id uuid references public.production_shift_starts(id);
alter table public.production_station_reports add column live_run_id uuid references public.production_live_runs(id);
create unique index production_report_run_once on public.production_station_reports(live_run_id) where live_run_id is not null and report_mode='production';
create index production_reports_station_item on public.production_station_reports(station_code,item_id,status);
create table public.production_material_baselines (
 station_code text not null references public.inventory_workstations(code),
 item_id uuid not null references public.inventory_items(id),
 run_id uuid not null references public.production_live_runs(id), quantity numeric not null,
 primary key(station_code,item_id,run_id)
);
alter table public.production_material_baselines enable row level security;
revoke all on public.production_material_baselines from anon,authenticated;

create function rls_internal.production_supply_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); leader boolean; request uuid:=(p_data->>'id')::uuid; station text; ingredient uuid; qty numeric; minutes numeric; old public.production_shift_starts; entry jsonb; product jsonb; start_at timestamptz; hours integer; session uuid; goal public.production_targets;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-request:'||request,0));
 if p_action='load' then
  if exists(select 1 from public.production_material_loads where id=request and created_by=uid) then return jsonb_build_object('saved',true);end if;
  station:=p_data->>'station_code';ingredient:=(p_data->>'item_id')::uuid;
  qty:=nullif(p_data->>'quantity','')::numeric;minutes:=nullif(p_data->>'alert_minutes','')::numeric;
  if qty is null or qty<=0 or qty>1000000000 or minutes is null or minutes not between 1 and 480 then raise exception 'ps_load_invalid';end if;
  if not exists(select 1 from public.inventory_workstations where code=station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=ingredient and category='RAW' and active) then raise exception 'pr_item_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('supply-station:'||station,0));
  -- First allocation is a physical starting balance; prior production must not be deducted from it.
  if not exists(select 1 from public.production_material_loads where station_code=station and item_id=ingredient) then
   insert into public.production_material_baselines(station_code,item_id,run_id,quantity)
    select station,ingredient,r.id,coalesce(r.latest_quantity,0)
    from public.production_live_runs r where r.station_code=station and r.deleted_at is null and r.closed_at is null;
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
end $$;

-- Names cover all checkpoints of a run, even when filtering one day of a multi-day session.
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
 manager:=public.inventory_access('production',true);
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,coalesce((select jsonb_agg(to_jsonb(z)) from (select distinct pc.created_by as uid,o.nombre as name from public.production_checkpoints pc left join public.operadores o on o.uid=pc.created_by where pc.run_id=r.id and pc.deleted_at is null) z),'[]'::jsonb) as contributors,(manager or r.created_by=auth.uid()) as can_manage,true as can_continue,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null  and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null  and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$
;

create function rls_internal.production_supply_snapshot()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return jsonb_build_object(
 'materials',coalesce((select jsonb_agg(to_jsonb(m)) from (
  select l.station_code,l.item_id,sum(l.quantity) as loaded_quantity,min(l.created_at) as tracked_at,
  (array_agg(l.alert_minutes order by l.created_at desc,l.id))[1] as alert_minutes,
  coalesce((select sum(c.quantity) from public.production_station_consumptions c join public.production_station_reports sr on sr.id=c.report_id where sr.station_code=l.station_code and c.ingredient_id=l.item_id and c.source='manufacturing' and sr.status='posted' and sr.reviewed_at>=min(l.created_at)),0) as confirmed_consumption,
  coalesce((select sum(bas.quantity*bl.quantity_per_unit*(1+bl.waste_rate)) from public.production_material_baselines bas join public.production_live_runs lr on lr.id=bas.run_id join public.inventory_boms ib on ib.finished_item_id=lr.item_id and ib.active and not ib.archived join public.inventory_bom_lines bl on bl.bom_id=ib.id and bl.ingredient_id=bas.item_id join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production' where bas.station_code=l.station_code and bas.item_id=l.item_id),0) as confirmed_baseline
  from public.production_material_loads l group by l.station_code,l.item_id
 ) m),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select lr.*,coalesce(sr.machine_quantity,0) as posted_quantity,
   coalesce((select jsonb_agg(jsonb_build_object('item_id',bl.ingredient_id,'per_unit',bl.quantity_per_unit*(1+bl.waste_rate))) from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id join public.inventory_items i on i.id=bl.ingredient_id and i.category='RAW' where ib.finished_item_id=lr.item_id and ib.active and not ib.archived),'[]'::jsonb) as raw_recipe
  from public.production_live_runs lr left join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production'
  where lr.deleted_at is null and (lr.closed_at is null or (sr.id is null and exists(select 1 from public.production_material_loads l where l.station_code=lr.station_code and l.created_at<=coalesce(lr.closed_at,now()))))
 ) r),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(to_jsonb(b)) from public.production_material_baselines b),'[]'::jsonb),
 'wip',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select sr.station_code,sr.item_id,sum(case when sr.report_mode='packing' then -sr.packed_quantity else sr.good_quantity-sr.packed_quantity end) quantity
  from public.production_station_reports sr where sr.status='posted' and not exists(select 1 from public.production_station_consumptions c where c.report_id=sr.id and c.source='repack') group by sr.station_code,sr.item_id
 ) w where w.quantity<>0),'[]'::jsonb),
 'loads',coalesce((select jsonb_agg(to_jsonb(l)) from (select ml.*,o.nombre as reporter_name from public.production_material_loads ml left join public.operadores o on o.uid=ml.created_by order by ml.created_at desc limit 100) l),'[]'::jsonb)
 );
end $$;
create function public.production_supply_action(p_action text,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select rls_internal.production_supply_action(p_action,p_data) $$;
create function public.production_supply_snapshot()
returns jsonb language sql security invoker set search_path='' as $$ select rls_internal.production_supply_snapshot() $$;
revoke all on function public.production_supply_action(text,jsonb),public.production_supply_snapshot() from public,anon;
revoke all on function rls_internal.production_supply_action(text,jsonb),rls_internal.production_supply_snapshot() from public,anon;
grant execute on function public.production_supply_action(text,jsonb),public.production_supply_snapshot(),rls_internal.production_supply_action(text,jsonb),rls_internal.production_supply_snapshot() to authenticated;
create trigger production_material_updates after insert on public.production_material_loads for each statement execute function rls_internal.production_progress_notify();
notify pgrst,'reload schema';


alter function rls_internal.production_station_action_core(text,jsonb) rename to production_station_action_supply_base;
create function rls_internal.production_station_action_core(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare run uuid; result uuid; lr public.production_live_runs;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in('save','submit') then
  run:=nullif(p_data->>'live_run_id','')::uuid;
  if run is null then select live_run_id into run from public.production_station_reports where id=(p_data->>'id')::uuid;end if;
  if run is not null then
   select * into lr from public.production_live_runs where id=run;
   if lr.id is null or lr.station_code is distinct from p_data->>'station_code' or lr.item_id is distinct from (p_data->>'item_id')::uuid or lr.deleted_at is not null then raise exception 'pr_invalid';end if;
   if p_action='submit' and p_data->>'report_mode'='production' and lr.closed_at is null then raise exception 'ps_finish_first';end if;
  end if;
 end if;
 result:=rls_internal.production_station_action_supply_base(p_action,p_data);
 if p_action in('save','submit') then update public.production_station_reports set live_run_id=run where id=result;end if;
 return result;
end $$;
revoke all on function rls_internal.production_station_action_core(text,jsonb),rls_internal.production_station_action_supply_base(text,jsonb) from public,anon;
grant execute on function rls_internal.production_station_action_core(text,jsonb) to authenticated;
notify pgrst,'reload schema';
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
 manager:=public.inventory_access('production',true);
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,coalesce((select jsonb_agg(to_jsonb(z)) from (select distinct pc.created_by as uid,o.nombre as name from public.production_checkpoints pc left join public.operadores o on o.uid=pc.created_by where pc.run_id=r.id and pc.deleted_at is null) z),'[]'::jsonb) as contributors,(manager or r.created_by=auth.uid()) as can_manage,true as can_continue,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null  and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('reporter_name',(select o.nombre from public.operadores o where o.uid=c.created_by)) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null  and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$
