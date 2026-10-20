create table public.production_shift_schedule (
 id uuid primary key, payload jsonb not null, started_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','started','failed','cancelled')),
 created_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), error_code text,
 executed_at timestamptz
);
alter table public.production_shift_schedule enable row level security;
revoke all on public.production_shift_schedule from public,anon,authenticated;
create index production_shift_schedule_due on public.production_shift_schedule(started_at) where status='scheduled';
create or replace function rls_internal.production_schedule_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare uid uuid:=auth.uid(); request uuid:=(p_data->>'id')::uuid; start_at timestamptz; hours integer; entry jsonb; item text; old public.production_shift_schedule;
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
 start_at:=(p_data->>'started_at')::timestamptz;hours:=(p_data->>'shift_hours')::integer;
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
   and s.started_at<start_at+make_interval(hours=>hours) and s.started_at+make_interval(hours=>(s.payload->>'shift_hours')::integer)>start_at) then raise exception 'ps_schedule_overlap';end if;
 end loop;
 insert into public.production_shift_schedule(id,payload,started_at,created_by) values(request,p_data,start_at,uid)
 on conflict(id) do update set payload=excluded.payload,started_at=excluded.started_at,created_by=excluded.created_by,status='scheduled',error_code=null,executed_at=null,updated_at=now();
 return jsonb_build_object('saved',true);
end $f$;
revoke all on function rls_internal.production_schedule_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_schedule_action(text,jsonb) to authenticated;
create or replace function public.production_schedule_action(p_action text,p_data jsonb) returns jsonb language sql set search_path='' as $f$select rls_internal.production_schedule_action($1,$2)$f$;
revoke all on function public.production_schedule_action(text,jsonb) from public,anon;
grant execute on function public.production_schedule_action(text,jsonb) to authenticated;
create or replace function rls_internal.production_process_schedule() returns integer language plpgsql security definer set search_path='' as $f$
declare s public.production_shift_schedule; processed integer:=0; claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); role_claim text:=current_setting('request.jwt.claim.role',true);
begin
 for s in select * from public.production_shift_schedule where status='scheduled' and started_at<=clock_timestamp() order by started_at,id for update skip locked limit 100 loop
  begin
   if not exists(select 1 from public.operadores where uid=s.created_by and activo) then raise exception 'pr_forbidden';end if;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',s.created_by,'role','authenticated')::text,true);
   perform set_config('request.jwt.claim.sub',s.created_by::text,true);
   perform set_config('request.jwt.claim.role','authenticated',true);
   perform rls_internal.production_supply_action('start',s.payload);
   update public.production_shift_schedule set status='started',executed_at=clock_timestamp(),updated_at=now(),error_code=null where id=s.id;
   processed:=processed+1;
  exception when others then
   update public.production_shift_schedule set status='failed',updated_at=now(),error_code=case when sqlerrm ~ '^(pr_|pl_|ps_|ra_)' then sqlerrm else 'pr_save_error' end where id=s.id;
  end;
 end loop;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 perform set_config('request.jwt.claim.role',coalesce(role_claim,''),true);
 return processed;
end $f$;
revoke all on function rls_internal.production_process_schedule() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION rls_internal.production_supply_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return jsonb_build_object('schedules',coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at) from public.production_shift_schedule s where s.status<>'cancelled' and s.started_at>=now()-interval '7 days'),'[]'::jsonb),
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
 (select r.*,coalesce((select jsonb_agg(to_jsonb(z)) from (select distinct pc.created_by as uid,o.nombre as name from public.production_checkpoints pc left join public.operadores o on o.uid=pc.created_by where pc.run_id=r.id and pc.deleted_at is null) z),'[]'::jsonb) as contributors,(manager or r.created_by=auth.uid()) as can_manage,true as can_continue,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by (c.recorded_at=r.closed_at) desc nulls last,c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null  and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('reporter_name',(select o.nombre from public.operadores o where o.uid=c.created_by)) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null  and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$
;
create extension if not exists pg_cron;
select cron.schedule('production-scheduled-shifts','* * * * *','select rls_internal.production_process_schedule()');
CREATE OR REPLACE FUNCTION rls_internal.production_parameter_export(p_from date, p_to date, p_station text DEFAULT ''::text, p_search text DEFAULT ''::text, p_outside boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare manager boolean; reports jsonb; total integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or length(coalesce(p_search,''))>100 then raise exception 'pr_time_invalid';end if;
 manager:=public.inventory_access('production',true);
 with base as (
  select c.*,req.version as capture_version,req.updated_at,req.updated_by,(select nombre from public.operadores where uid=req.updated_by limit 1) as updated_by_name,case when jsonb_array_length(c.products)>0 then c.products else
   jsonb_agg(jsonb_build_object('item_id',c.item_id,'part_number',c.part_number,'part_name',c.part_name)) over(partition by c.capture_group_id order by c.part_number,c.id rows between unbounded preceding and unbounded following) end as capture_products
  from public.production_parameter_checks c join public.production_parameter_requests req on req.id=c.capture_group_id where req.deleted_at is null and (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station)
 ), grouped as (
  select distinct on(capture_group_id) * from base order by capture_group_id,id
 ), eligible as (
  select (to_jsonb(g)-'capture_products')||jsonb_build_object('products',g.capture_products,'author_role',coalesce((select m.role from public.global_department_memberships m where m.user_id=g.leader_id and m.department='production' limit 1),''),
    'part_number',(select string_agg(x->>'part_number',' / ') from jsonb_array_elements(g.capture_products) x),
    'part_name',(select string_agg(x->>'part_name',' / ') from jsonb_array_elements(g.capture_products) x)) as report,g.recorded_at,g.id
  from grouped g where (coalesce(p_search,'')='' or concat_ws(' ',g.capture_products::text,g.leader_name,g.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or g.out_of_range)
 ) select (select count(*) from eligible),coalesce((select jsonb_agg(x.report order by x.recorded_at desc,x.id) from (select * from eligible order by recorded_at desc,id )x),'[]') into total,reports;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t where t.deleted_at is null),'reports',reports,'total',total,'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo and m.role in ('supervisor','lider') and nullif(trim(o.nombre),'') is not null));
end $function$
;
revoke all on function rls_internal.production_parameter_export(date,date,text,text,boolean) from public,anon;grant execute on function rls_internal.production_parameter_export(date,date,text,text,boolean) to authenticated;
create or replace function public.production_parameter_export(p_from date,p_to date,p_station text default '',p_search text default '',p_outside boolean default false) returns jsonb language sql set search_path='' as $f$select rls_internal.production_parameter_export($1,$2,$3,$4,$5)$f$;
revoke all on function public.production_parameter_export(date,date,text,text,boolean) from public,anon;grant execute on function public.production_parameter_export(date,date,text,text,boolean) to authenticated;
