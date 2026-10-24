CREATE OR REPLACE FUNCTION rls_internal.receiving_start(p_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_stage uuid; v_others uuid[]; v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not (rls_internal.role_activity_access('receiving','unload')) then raise exception 'ra_denied';end if;
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 if v_operator<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if not exists(select 1 from public.operadores o where o.uid=v_operator and o.activo and
 (exists(select 1 from public.global_department_memberships where user_id=v_operator and department='receiving' and active)
 or exists(select 1 from public.global_system_admins where user_id=v_operator))) then raise exception 'receiving_invalid_operator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_receipts where id=p_id and created_by=auth.uid()) then return p_id; end if;
 v_others:=rls_internal.receiving_operators(v_operator,p_data->'additional_operator_ids');
 select id into v_stage from public.receiving_locations where is_system_stage and active;
 if v_stage is null then raise exception 'receiving_invalid'; end if;
 if not exists(select 1 from public.receiving_suppliers where id=(p_data->>'supplier_id')::uuid and active)
 then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_receipts(id,supplier_id,manifest,trailer,dock,staging_id,po_number,created_by)
 values(p_id,(p_data->>'supplier_id')::uuid,btrim(p_data->>'manifest'),upper(btrim(p_data->>'trailer')),p_data->>'dock',v_stage,coalesce(btrim(p_data->>'po_number'),''),auth.uid());
 for v_line in select value from jsonb_array_elements(coalesce(p_data->'lines','[]'::jsonb)) loop
 if not exists(select 1 from public.inventory_items where id=(v_line->>'item_id')::uuid and active and category in ('RAW','PACKAGING')) then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_lines(receipt_id,item_id,lot,expected) values(p_id,(v_line->>'item_id')::uuid,upper(btrim(coalesce(v_line->>'lot',''))),(v_line->>'expected')::numeric);
 end loop;
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id,additional_operator_ids) values(p_id,p_id,'unload',v_operator,v_others);
 return p_id;
end $function$
;
alter table public.receiving_receipts add column contents_version integer not null default 0;
alter table public.receiving_tasks add column putaway_group_id uuid;
drop index public.receiving_tasks_operator_running;
-- The advisory-lock guard enforces one running activity, allowing only destinations within the same batch.
create index receiving_tasks_operator_running on public.receiving_tasks(operator_id) where status='running';
create index receiving_tasks_putaway_group_idx on public.receiving_tasks(putaway_group_id) where putaway_group_id is not null;
create table rls_internal.receiving_operation_requests(id uuid primary key,actor uuid not null,operation text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table rls_internal.receiving_operation_requests enable row level security;
revoke all on rls_internal.receiving_operation_requests from public,anon,authenticated;

create or replace function rls_internal.receiving_identify(p_id uuid,p_receipt uuid,p_version integer,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare r public.receiving_receipts; old public.receiving_lines; request rls_internal.receiving_operation_requests; entry jsonb; line_id uuid; item uuid; qty numeric; delta numeric; reserved numeric; category text; payload jsonb:=jsonb_build_object('receipt',p_receipt,'version',p_version,'lines',p_lines);
begin
 if auth.uid() is null or not rls_internal.receiving_access() or not rls_internal.role_activity_access('receiving','putaway') then raise exception 'receiving_forbidden';end if;
 if p_id is null then raise exception 'receiving_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('receiving-operation:'||p_id,0));
 select * into request from rls_internal.receiving_operation_requests where id=p_id;
 if found then
  if request.actor<>auth.uid() or request.operation<>'identify' or request.payload<>payload then raise exception 'receiving_invalid';end if;
  return request.result;
 end if;
 select * into r from public.receiving_receipts where id=p_receipt for update;
 if r.id is null or r.status<>'received' or r.contents_version<>p_version then raise exception 'rx_changed';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'receiving_invalid';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'receiving_invalid';end if;
 -- Existing lines cannot disappear; old material, lots, holds and completed transfers remain traceable.
 if exists(select 1 from public.receiving_lines l where l.receipt_id=r.id and not exists(select 1 from jsonb_array_elements(p_lines) e where e->>'id'=l.id::text)) then raise exception 'receiving_invalid';end if;
 for entry in select value from jsonb_array_elements(p_lines) order by value->>'id' loop
  line_id:=(entry->>'id')::uuid;item:=(entry->>'item_id')::uuid;qty:=(entry->>'received')::numeric;
  if line_id is null or qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity';end if;
  select i.category into category from public.inventory_items i where i.id=item and i.active and i.category in ('RAW','PACKAGING','SEMI','FG');
  if not found then raise exception 'receiving_invalid';end if;
  select * into old from public.receiving_lines where id=line_id for update;
  if found then
   if old.receipt_id<>r.id or old.item_id<>item then raise exception 'receiving_invalid';end if;
   select coalesce(sum(quantity),0) into reserved from public.receiving_tasks where receiving_tasks.line_id=old.id and status<>'cancelled';
   if qty<reserved or qty<old.damaged or (old.hold_id is not null and qty<>old.received) then raise exception 'receiving_quantity';end if;
   delta:=qty-old.received;
   update public.receiving_lines set received=qty,note=coalesce(entry->>'note',note) where id=line_id;
  else
   insert into public.receiving_lines(id,receipt_id,item_id,lot,expected,received,note) values(line_id,r.id,item,upper(btrim(coalesce(entry->>'lot',''))),qty,qty,coalesce(entry->>'note',''));
   delta:=qty;
  end if;
  if delta<>0 then
   insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,note,created_by)
   select item,category,delta,'RECEIPT',code,coalesce((select lot from public.receiving_lines where id=line_id),''),'receiving-identify:'||p_id||':'||line_id,coalesce(entry->>'note',''),auth.uid() from public.receiving_locations where id=r.staging_id;
  end if;
 end loop;
 update public.receiving_receipts set contents_version=contents_version+1 where id=r.id;
 insert into rls_internal.receiving_operation_requests values(p_id,auth.uid(),'identify',payload,jsonb_build_object('saved',true,'version',r.contents_version+1),now());
 return jsonb_build_object('saved',true,'version',r.contents_version+1);
end $f$;
create or replace function public.receiving_identify(p_id uuid,p_receipt uuid,p_version integer,p_lines jsonb)
returns jsonb language sql security invoker set search_path='' as $f$ select rls_internal.receiving_identify(p_id,p_receipt,p_version,p_lines); $f$;
revoke all on function public.receiving_identify(uuid,uuid,integer,jsonb),rls_internal.receiving_identify(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.receiving_identify(uuid,uuid,integer,jsonb),rls_internal.receiving_identify(uuid,uuid,integer,jsonb) to authenticated;

create or replace function rls_internal.receiving_running_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare v_operator uuid;
begin
 if new.status='running' then
  for v_operator in select distinct uid from unnest(array_append(new.additional_operator_ids,new.operator_id)) a(uid) order by uid loop
   perform pg_advisory_xact_lock(hashtextextended('receiving-operator:'||v_operator,0));
   if exists(select 1 from public.receiving_tasks t where t.id<>new.id and t.status='running' and (t.operator_id=v_operator or v_operator=any(t.additional_operator_ids))
    and not(new.kind='putaway' and new.putaway_group_id is not null and t.kind='putaway' and t.putaway_group_id=new.putaway_group_id and t.receipt_id=new.receipt_id))
   then raise exception 'receiving_operator_busy';end if;
  end loop;
 end if;
 return new;
end $f$;

create or replace function rls_internal.receiving_putaway_batch(p_id uuid,p_line uuid,p_allocations jsonb,p_operators jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare l public.receiving_lines; a jsonb; qty numeric; reserved numeric; total numeric:=0; others uuid[]; request rls_internal.receiving_operation_requests; payload jsonb:=jsonb_build_object('line',p_line,'allocations',p_allocations,'operators',p_operators); ids jsonb:='[]'; task_id uuid; i integer:=0;
begin
 if auth.uid() is null or not rls_internal.receiving_access() or not rls_internal.role_activity_access('receiving','putaway') then raise exception 'receiving_forbidden';end if;
 if p_id is null then raise exception 'receiving_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('receiving-operation:'||p_id,0));
 select * into request from rls_internal.receiving_operation_requests where id=p_id;
 if found then
  if request.actor<>auth.uid() or request.operation<>'putaway' or request.payload<>payload then raise exception 'receiving_invalid';end if;
  return request.result;
 end if;
 others:=rls_internal.receiving_operators(auth.uid(),p_operators);
 select * into l from public.receiving_lines where id=p_line for update;
 if l.id is null or not exists(select 1 from public.receiving_receipts where id=l.receipt_id and status='received') then raise exception 'receiving_invalid';end if;
 if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) not between 1 and 30 or
 (select count(distinct value->>'location_id') from jsonb_array_elements(p_allocations))<>jsonb_array_length(p_allocations) then raise exception 'receiving_invalid';end if;
 select coalesce(sum(quantity),0) into reserved from public.receiving_tasks where line_id=l.id and status<>'cancelled';
 for a in select value from jsonb_array_elements(p_allocations) loop
  qty:=(a->>'quantity')::numeric;
  if qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity';end if;
  if not exists(select 1 from public.receiving_locations where id=(a->>'location_id')::uuid and active and not is_system_stage) or
   (exists(select 1 from public.receiving_item_locations where item_id=l.item_id) and not exists(select 1 from public.receiving_item_locations where item_id=l.item_id and location_id=(a->>'location_id')::uuid)) then raise exception 'receiving_location';end if;
  total:=total+qty;
 end loop;
 if total>l.received-reserved then raise exception 'receiving_quantity';end if;
 for a in select value from jsonb_array_elements(p_allocations) loop
  i:=i+1;task_id:=md5(p_id::text||':'||i)::uuid;
  insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id,additional_operator_ids,putaway_group_id)
  values(task_id,l.receipt_id,'putaway',l.id,(a->>'location_id')::uuid,(a->>'quantity')::numeric,auth.uid(),others,p_id);
  ids:=ids||jsonb_build_array(task_id);
 end loop;
 insert into rls_internal.receiving_operation_requests values(p_id,auth.uid(),'putaway',payload,ids,now());
 return ids;
end $f$;
create or replace function public.receiving_putaway_batch(p_id uuid,p_line uuid,p_allocations jsonb,p_operators jsonb default '[]')
returns jsonb language sql security invoker set search_path='' as $f$ select rls_internal.receiving_putaway_batch(p_id,p_line,p_allocations,p_operators); $f$;
revoke all on function public.receiving_putaway_batch(uuid,uuid,jsonb,jsonb),rls_internal.receiving_putaway_batch(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.receiving_putaway_batch(uuid,uuid,jsonb,jsonb),rls_internal.receiving_putaway_batch(uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function rls_internal.receiving_task_group(p_id uuid,p_action text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $f$
declare task public.receiving_tasks; id uuid;
begin
 if auth.uid() is null or not rls_internal.receiving_access() then raise exception 'receiving_forbidden';end if;
 select * into task from public.receiving_tasks where receiving_tasks.id=p_id;
 if task.id is null then raise exception 'receiving_invalid';end if;
 if task.putaway_group_id is null then return rls_internal.receiving_task(p_id,p_action,p_lines);end if;
 perform 1 from public.receiving_lines where receiving_lines.id=task.line_id for update;
 for id in select t.id from public.receiving_tasks t where t.putaway_group_id=task.putaway_group_id order by t.id loop
  perform rls_internal.receiving_task(id,p_action,'[]');
 end loop;
 return p_id;
end $f$;
create or replace function public.receiving_task_group(p_id uuid,p_action text,p_lines jsonb default '[]')
returns uuid language sql security invoker set search_path='' as $f$ select rls_internal.receiving_task_group(p_id,p_action,p_lines); $f$;
revoke all on function public.receiving_task_group(uuid,text,jsonb),rls_internal.receiving_task_group(uuid,text,jsonb) from public,anon;
grant execute on function public.receiving_task_group(uuid,text,jsonb),rls_internal.receiving_task_group(uuid,text,jsonb) to authenticated;

create policy receiving_operation_private on rls_internal.receiving_operation_requests for all to authenticated using(false) with check(false);
-- A new report permission is granted only to the management roles; existing custom choices remain intact.
insert into public.global_role_activity_catalog(department,activity,allowed_roles,default_roles) values('production','kpi',array['lider','supervisor'],array['lider','supervisor']);
update public.global_role_access_profiles set activities=array_append(activities,'kpi'),version=version+1,updated_at=now() where department='production' and role in ('supervisor','lider') and not('kpi'=any(activities));

create or replace function rls_internal.production_kpi_items()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
begin
 if auth.uid() is null or not rls_internal.role_activity_access('production','kpi') or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'part_number',part_number,'part_name',coalesce(part_name,description),'active',active) order by part_number) from public.inventory_items where category='FG'),'[]');
end $f$;
create or replace function public.production_kpi_items() returns jsonb language sql stable security invoker set search_path='' as $f$ select rls_internal.production_kpi_items(); $f$;
revoke all on function public.production_kpi_items(),rls_internal.production_kpi_items() from public,anon;
grant execute on function public.production_kpi_items(),rls_internal.production_kpi_items() to authenticated;

create or replace function rls_internal.production_kpi_snapshot(p_from date,p_to date,p_items uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare item_ids uuid[]; result jsonb;
begin
 if auth.uid() is null or not rls_internal.role_activity_access('production','kpi') or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or coalesce(cardinality(p_items),0) not between 1 and 100
 or exists(select 1 from unnest(p_items) requested(item_id) where not exists(select 1 from public.inventory_items i where i.id=requested.item_id and category='FG')) then raise exception 'kt_invalid';end if;
 with recursive graph(id,path,depth) as(
  select x,array[x],0 from unnest(p_items) x
  union all select l.ingredient_id,g.path||l.ingredient_id,g.depth+1 from graph g join public.inventory_boms b on b.finished_item_id=g.id and b.active and not b.archived
  join public.inventory_bom_lines l on l.bom_id=b.id join public.inventory_items i on i.id=l.ingredient_id and i.category in ('SEMI','FG')
  where g.depth<12 and not l.ingredient_id=any(g.path)
 ) select array_agg(distinct id) into item_ids from graph;
 result:=jsonb_build_object('from',p_from,'to',p_to,'generated_at',now(),'timezone','America/Los_Angeles',
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'part_number',part_number,'part_name',coalesce(part_name,description),'category',category)),'[]') from public.inventory_items where id=any(item_ids)),
 'stations',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'machine_type',machine_type)),'[]') from public.inventory_workstations),
 'edges',(select coalesce(jsonb_agg(jsonb_build_object('parent',b.finished_item_id,'child',l.ingredient_id,'quantity',l.quantity_per_unit)),'[]') from public.inventory_boms b join public.inventory_bom_lines l on l.bom_id=b.id where b.active and not b.archived and b.finished_item_id=any(item_ids) and l.ingredient_id=any(item_ids)),
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.production_station_reports r where r.item_id=any(item_ids) and r.production_date between p_from and p_to and r.status in ('submitted','posted') and not coalesce(r.progress_draft,false) and r.report_mode='production'),
 'runs',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.production_live_runs r where r.item_id=any(item_ids) and r.deleted_at is null and r.started_at >= (p_from::timestamp at time zone 'America/Los_Angeles') and r.started_at < ((p_to+2)::timestamp at time zone 'America/Los_Angeles')),
 'schedules',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.production_shift_schedule s where s.status in ('scheduled','failed') and s.started_at >= (p_from::timestamp at time zone 'America/Los_Angeles') and s.started_at < ((p_to+2)::timestamp at time zone 'America/Los_Angeles')),
 'targets',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.production_targets t where item_id=any(item_ids) and deleted_at is null),
 'opening',(select coalesce(jsonb_agg(x),'[]') from(select item_id,sum(quantity_delta) quantity from public.inventory_movements where area='FG' and item_id=any(p_items) and effective_date<p_from group by item_id)x),
 'movements',(select coalesce(jsonb_agg(x),'[]') from(select item_id,effective_date as day,kind,sum(quantity_delta) quantity from public.inventory_movements where area='FG' and item_id=any(p_items) and effective_date between p_from and p_to group by item_id,effective_date,kind)x),
 'demand_source',(select to_jsonb(i) from public.inventory_demand_imports i where status='active' order by activated_at desc limit 1),
 'demand',(select coalesce(jsonb_agg(x),'[]') from(select l.part_number,l.ship_date as day,sum(l.quantity) quantity from public.inventory_demand_lines l where l.import_id=(select id from public.inventory_demand_imports where status='active' order by activated_at desc limit 1) and ship_date between p_from and p_to+14 and l.part_number in(select part_number from public.inventory_items where id=any(p_items)) group by l.part_number,l.ship_date)x));
 return result;
end $f$;
create or replace function public.production_kpi_snapshot(p_from date,p_to date,p_items uuid[]) returns jsonb language sql stable security invoker set search_path='' as $f$ select rls_internal.production_kpi_snapshot(p_from,p_to,p_items); $f$;
revoke all on function public.production_kpi_snapshot(date,date,uuid[]),rls_internal.production_kpi_snapshot(date,date,uuid[]) from public,anon;
grant execute on function public.production_kpi_snapshot(date,date,uuid[]),rls_internal.production_kpi_snapshot(date,date,uuid[]) to authenticated;
