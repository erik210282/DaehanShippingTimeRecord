alter policy bom_packaging_read on public.inventory_bom_packaging using (rls_internal.catalog_access() or rls_internal.inventory_access('production'));
alter policy bom_packaging_lines_read on public.inventory_bom_packaging_lines using (rls_internal.catalog_access() or rls_internal.inventory_access('production'));
alter policy catalog_updates_read on public.catalog_updates using (rls_internal.catalog_access() or rls_internal.inventory_access('production'));
alter table public.production_material_loads add column if not exists updated_at timestamptz, add column if not exists updated_by uuid references auth.users(id), add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references auth.users(id);
create table if not exists rls_internal.production_material_load_audit (
 id bigint generated always as identity primary key, load_id uuid not null, action text not null, actor uuid not null, before_data jsonb not null, after_data jsonb not null, created_at timestamptz not null default now()
);
alter table rls_internal.production_material_load_audit enable row level security;
revoke all on rls_internal.production_material_load_audit from public,anon,authenticated;
create or replace function rls_internal.production_material_load_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid(); before_row public.production_material_loads; after_row public.production_material_loads; station text; qty numeric;
begin
 if actor is null or not rls_internal.role_activity_access('production','materials') or not public.inventory_access('production') or not (
 public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=actor and department='production' and active and role='lider')
 ) then raise exception 'pr_forbidden';end if;
 if p_action not in ('edit','delete') or p_data->>'id' is null then raise exception 'pr_invalid';end if;
 select station_code into station from public.production_material_loads where id=(p_data->>'id')::uuid;
 if station is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-station:'||station,0));
 select * into before_row from public.production_material_loads where id=(p_data->>'id')::uuid for update;
 if before_row.deleted_at is not null then
  if p_action='delete' then return jsonb_build_object('saved',true);end if;
  raise exception 'ps_load_changed';
 end if;
 if nullif(p_data->>'version','')::timestamptz is distinct from coalesce(before_row.updated_at,before_row.created_at) then raise exception 'ps_load_changed';end if;
 if p_action='edit' then
  qty:=nullif(p_data->>'quantity','')::numeric;
  if qty is null or qty<=0 or qty>1000000000 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'ps_load_invalid';end if;
  update public.production_material_loads set quantity=qty,updated_at=clock_timestamp(),updated_by=actor where id=before_row.id returning * into after_row;
 else
  update public.production_material_loads set deleted_at=clock_timestamp(),deleted_by=actor,updated_at=clock_timestamp(),updated_by=actor where id=before_row.id returning * into after_row;
 end if;
 insert into rls_internal.production_material_load_audit(load_id,action,actor,before_data,after_data) values(before_row.id,p_action,actor,to_jsonb(before_row),to_jsonb(after_row));
 return jsonb_build_object('saved',true);
end $fn$;
revoke all on function rls_internal.production_material_load_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_material_load_action(text,jsonb) to authenticated;
create or replace function public.production_material_load_action(p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $fn$ select rls_internal.production_material_load_action(p_action,p_data) $fn$;
revoke all on function public.production_material_load_action(text,jsonb) from public,anon;
grant execute on function public.production_material_load_action(text,jsonb) to authenticated;
drop trigger if exists production_material_updates on public.production_material_loads;
create trigger production_material_updates after insert or update or delete on public.production_material_loads for each statement execute function rls_internal.production_progress_notify();
CREATE OR REPLACE FUNCTION rls_internal.production_supply_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return jsonb_build_object('schedules',coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at) from public.production_shift_schedule s where s.status in ('scheduled','failed') and s.started_at>=now()-interval '7 days'),'[]'::jsonb),
 'station_materials',coalesce((select jsonb_agg(jsonb_build_object('station_code',w.code,'item_id',m.item_id)) from public.inventory_workstations w cross join lateral rls_internal.production_station_raw_ids(w.code) m where w.active),'[]'::jsonb),
 'materials',coalesce((select jsonb_agg(to_jsonb(m)) from (
  select l.station_code,l.item_id,sum(case when l.deleted_at is null then l.quantity else 0 end) as loaded_quantity,min(l.created_at) as tracked_at,
  15::numeric as alert_minutes,
  coalesce((select sum(u.quantity) from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id),0) as confirmed_consumption,
  0::numeric as confirmed_baseline
  from public.production_material_loads l group by l.station_code,l.item_id having bool_or(l.deleted_at is null) or exists(select 1 from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id)
 ) m),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select lr.*,coalesce(sr.machine_quantity,0) as posted_quantity,
   coalesce((select jsonb_agg(jsonb_build_object('item_id',bl.ingredient_id,'per_unit',bl.quantity_per_unit*(1+bl.waste_rate))) from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id join public.inventory_items i on i.id=bl.ingredient_id and i.category in ('RAW','SEMI') where ib.finished_item_id=lr.item_id and ib.active and not ib.archived),'[]'::jsonb) as raw_recipe
  from public.production_live_runs lr left join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production'
  where lr.deleted_at is null and (lr.closed_at is null or sr.id is null)
 ) r),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(to_jsonb(b)) from public.production_material_baselines b),'[]'::jsonb),
 'wip',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select sr.station_code,sr.item_id,sum(case when sr.report_mode='packing' then -sr.packed_quantity else sr.good_quantity-sr.packed_quantity end) quantity
  from public.production_station_reports sr where sr.status='posted' and not exists(select 1 from public.production_station_consumptions c where c.report_id=sr.id and c.source='repack') group by sr.station_code,sr.item_id
 ) w where w.quantity<>0),'[]'::jsonb),
 'loads',coalesce((select jsonb_agg(to_jsonb(l)) from (select ml.*,o.nombre as reporter_name from public.production_material_loads ml left join public.operadores o on o.uid=ml.created_by where ml.deleted_at is null order by ml.created_at desc) l),'[]'::jsonb)
 );
end $function$

