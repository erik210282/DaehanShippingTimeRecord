-- One stock identity and catalog for every department. Existing balances are preserved.
create function rls_internal.catalog_access(p_manage boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.operadores where uid=auth.uid() and activo)
 and (exists(select 1 from public.global_system_admins where user_id=auth.uid())
 or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active
 and (not p_manage or role in ('lider','supervisor'))));
$$;
revoke all on function rls_internal.catalog_access(boolean) from public,anon;
grant execute on function rls_internal.catalog_access(boolean) to authenticated;
do $$ declare v_table text; begin
 foreach v_table in array array['receiving_suppliers','receiving_locations','receiving_material_types','receiving_item_types','receiving_item_locations'] loop
 execute format('create policy shared_catalog_read on public.%I for select to authenticated using (rls_internal.catalog_access())',v_table);
 end loop;
end $$;
create unique index inventory_items_normalized_part on public.inventory_items(upper(btrim(part_number)));
create or replace function public.inventory_sync_product() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_item public.inventory_items%rowtype;
begin
 if nullif(btrim(new.part_number),'') is null or upper(btrim(new.part_number))='NA' then return new; end if;
 select * into v_item from public.inventory_items where upper(btrim(part_number))=upper(btrim(new.part_number)) for update;
 if found and (v_item.category<>'FG' or (v_item.producto_id is not null and v_item.producto_id<>new.id)) then raise exception 'catalog_duplicate_part'; end if;
 if found and v_item.producto_id is null then
 update public.inventory_items set producto_id=new.id,description=coalesce(nullif(new.nombre,''),new.descripcion,''),active=coalesce(new.activo,true) where id=v_item.id;
 else
 insert into public.inventory_items(producto_id,part_number,description,category,uom,responsible_department,active)
 values(new.id,upper(btrim(new.part_number)),coalesce(nullif(new.nombre,''),new.descripcion,''),'FG','EA','inventory',coalesce(new.activo,true))
 on conflict(producto_id) do update set part_number=excluded.part_number,description=excluded.description,active=excluded.active;
 end if;
 return new;
end $$;
revoke all on function public.inventory_sync_product() from public,anon,authenticated;
-- Any existing standalone FG joins Shipping without changing its inventory ID.
insert into public.productos(nombre,part_number,descripcion,activo)
select description,part_number,description,active from public.inventory_items where category='FG' and producto_id is null;
create or replace function rls_internal.receiving_catalog(p_kind text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_type public.receiving_material_types%rowtype; v_code text; v_product public.productos%rowtype; v_product_id uuid; v_min numeric; v_existing public.inventory_items%rowtype; v_shipping jsonb; v_key text; v_id uuid := coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
begin
 if not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden'; end if;
 if p_kind='material' then
 v_code:=upper(btrim(p_data->>'code'));
 if exists(select 1 from public.receiving_material_types where code=v_code and category<>p_data->>'category'
 and (builtin or exists(select 1 from public.receiving_item_types where material_type=v_code) or exists(select 1 from public.receiving_locations where material_type=v_code))) then raise exception 'receiving_item_locked'; end if;
 insert into public.receiving_material_types(code,name,category,active) values(v_code,btrim(p_data->>'name'),p_data->>'category',coalesce((p_data->>'active')::boolean,true))
 on conflict(code) do update set name=excluded.name,category=excluded.category,active=excluded.active;
 return v_id;
 elsif p_kind='supplier' then
 insert into public.receiving_suppliers(id,code,name,street,exterior_number,interior_number,neighborhood,city,state,postal_code,country,phone,active) values(v_id,upper(btrim(p_data->>'code')),btrim(p_data->>'name'),coalesce(btrim(p_data->>'street'),''),coalesce(btrim(p_data->>'exterior_number'),''),coalesce(btrim(p_data->>'interior_number'),''),coalesce(btrim(p_data->>'neighborhood'),''),coalesce(btrim(p_data->>'city'),''),coalesce(btrim(p_data->>'state'),''),coalesce(btrim(p_data->>'postal_code'),''),coalesce(btrim(p_data->>'country'),''),coalesce(btrim(p_data->>'phone'),''),coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set code=excluded.code,name=excluded.name,street=excluded.street,exterior_number=excluded.exterior_number,interior_number=excluded.interior_number,neighborhood=excluded.neighborhood,city=excluded.city,state=excluded.state,postal_code=excluded.postal_code,country=excluded.country,phone=excluded.phone,active=excluded.active;
 elsif p_kind='location' then
 if exists(select 1 from public.receiving_locations where id=v_id and is_system_stage) then raise exception 'receiving_location'; end if;
 select * into v_type from public.receiving_material_types where code=coalesce(p_data->>'material_type','RAW') and active;
 if not found then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_locations(id,code,name,area,kind,material_type,active) values(v_id,upper(btrim(p_data->>'code')),btrim(p_data->>'name'),coalesce(p_data->>'area',''),coalesce(p_data->>'kind',case when v_type.category='HOLD' then 'QUALITY' else 'STORAGE' end),v_type.code,coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set code=excluded.code,name=excluded.name,area=excluded.area,kind=excluded.kind,material_type=excluded.material_type,active=excluded.active;
 elsif p_kind='item' then
 select * into v_existing from public.inventory_items where id=v_id for update;
 select * into v_type from public.receiving_material_types where code=coalesce(p_data->>'material_type',p_data->>'category',v_existing.category,'FG') and active and category<>'HOLD';
 if not found then raise exception 'receiving_invalid'; end if;
 v_min:=coalesce(nullif(p_data->>'minimum_quantity','')::numeric,v_existing.minimum_quantity,0);
 if v_min<0 or v_min::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity'; end if;
 if nullif(btrim(p_data->>'part_number'),'') is null or nullif(btrim(p_data->>'uom'),'') is null then raise exception 'receiving_invalid'; end if;
 if exists(select 1 from public.inventory_items where id<>v_id and upper(btrim(part_number))=upper(btrim(p_data->>'part_number'))) then raise exception 'catalog_duplicate_part'; end if;
 if v_existing.id is not null and (v_existing.category<>v_type.category or v_existing.uom<>upper(btrim(p_data->>'uom')))
 and (v_existing.producto_id is not null or exists(select 1 from public.inventory_movements where item_id=v_id) or exists(select 1 from public.receiving_lines where item_id=v_id)) then raise exception 'receiving_item_locked'; end if;
 if v_type.category='FG' then
 v_product_id:=coalesce(v_existing.producto_id,nullif(p_data->>'producto_id','')::uuid,gen_random_uuid());
 select * into v_product from public.productos where id=v_product_id;
 v_shipping:=coalesce(p_data->'shipping','{}'::jsonb);
 -- Populate only Shipping's editable fields; IDs and inventory fields are never client writable here.
 for v_key in select jsonb_object_keys(v_shipping) loop
 if v_key not in ('nombre','descripcion','peso_por_pieza','bin_type','tipo_empaque_retornable','tipo_empaque_expendable','peso_caja_retornable','peso_caja_expendable','cantidad_por_caja_retornable','cantidad_por_caja_expendable') then v_shipping:=v_shipping-v_key; end if;
 end loop;
 v_product:=jsonb_populate_record(v_product,v_shipping || jsonb_build_object('id',v_product_id,'nombre',coalesce(nullif(v_shipping->>'nombre',''),p_data->>'description',p_data->>'part_number'),'descripcion',coalesce(v_shipping->>'descripcion',p_data->>'description',''),'part_number',upper(btrim(p_data->>'part_number')),'activo',coalesce((p_data->>'active')::boolean,true)));
 insert into public.productos select (v_product).* on conflict(id) do update set
 nombre=excluded.nombre,part_number=excluded.part_number,descripcion=excluded.descripcion,activo=excluded.activo,peso_por_pieza=excluded.peso_por_pieza,bin_type=excluded.bin_type,
 tipo_empaque_retornable=excluded.tipo_empaque_retornable,tipo_empaque_expendable=excluded.tipo_empaque_expendable,peso_caja_retornable=excluded.peso_caja_retornable,peso_caja_expendable=excluded.peso_caja_expendable,cantidad_por_caja_retornable=excluded.cantidad_por_caja_retornable,cantidad_por_caja_expendable=excluded.cantidad_por_caja_expendable;
 if upper(btrim(p_data->>'part_number'))='NA' then return v_product_id; end if;
 select id into v_id from public.inventory_items where producto_id=v_product_id;
 update public.inventory_items set minimum_quantity=v_min,uom=upper(btrim(p_data->>'uom')),responsible_department=coalesce(p_data->>'responsible_department',responsible_department),default_location=p_data->>'default_location' where id=v_id;
 else
 insert into public.inventory_items(id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active)
 values(v_id,upper(btrim(p_data->>'part_number')),coalesce(p_data->>'description',''),v_type.category,upper(btrim(p_data->>'uom')),v_min,coalesce(p_data->>'responsible_department','receiving'),p_data->>'default_location',coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set part_number=excluded.part_number,description=excluded.description,category=excluded.category,uom=excluded.uom,minimum_quantity=excluded.minimum_quantity,responsible_department=excluded.responsible_department,default_location=excluded.default_location,active=excluded.active;
 end if;
 if jsonb_typeof(coalesce(p_data->'locations','[]'::jsonb)) is distinct from 'array'
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb)) a(value)
 where not exists(select 1 from public.receiving_locations where id=value::uuid and active and not is_system_stage)) then raise exception 'receiving_location'; end if;
 insert into public.receiving_item_types(item_id,material_type) values(v_id,v_type.code) on conflict(item_id) do update set material_type=excluded.material_type;
 delete from public.receiving_item_locations where item_id=v_id;
 insert into public.receiving_item_locations(item_id,location_id)
 select v_id,value::uuid from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb))
 ;
 else raise exception 'receiving_invalid'; end if;
 return v_id;
end $$;
create function public.shared_catalog(p_kind text,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_catalog($1,$2); $$;
revoke all on function public.shared_catalog(text,jsonb) from public,anon;
grant execute on function public.shared_catalog(text,jsonb) to authenticated;
alter table public.receiving_tasks add column additional_operator_ids uuid[] not null default '{}';
create index receiving_tasks_additional_operators on public.receiving_tasks using gin(additional_operator_ids);
drop index public.receiving_tasks_operator_active;
create unique index receiving_tasks_operator_running on public.receiving_tasks(operator_id) where status='running';
create function rls_internal.receiving_operators(p_primary uuid,p_others jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare v_operators uuid[];
begin
 if jsonb_typeof(coalesce(p_others,'[]'::jsonb))<>'array' then raise exception 'receiving_invalid_operator'; end if;
 select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_operators from jsonb_array_elements_text(coalesce(p_others,'[]'::jsonb)) where value::uuid<>p_primary;
 if exists(select 1 from unnest(array_append(v_operators,p_primary)) a(uid) where not exists(select 1 from public.operadores o where o.uid=a.uid and o.activo and (exists(select 1 from public.global_department_memberships where user_id=o.uid and department='receiving' and active) or (a.uid=p_primary and exists(select 1 from public.global_system_admins where user_id=o.uid))))) then raise exception 'receiving_invalid_operator'; end if;
 return v_operators;
end $$;
revoke all on function rls_internal.receiving_operators(uuid,jsonb) from public,anon,authenticated;
create function rls_internal.receiving_running_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_operator uuid;
begin
 if new.status='running' then
 for v_operator in select distinct uid from unnest(array_append(new.additional_operator_ids,new.operator_id)) a(uid) order by uid loop
 perform pg_advisory_xact_lock(hashtextextended('receiving-operator:'||v_operator,0));
 if exists(select 1 from public.receiving_tasks where id<>new.id and status='running' and (operator_id=v_operator or v_operator=any(additional_operator_ids))) then raise exception 'receiving_operator_busy'; end if;
 end loop;
 end if;
 return new;
end $$;
revoke all on function rls_internal.receiving_running_guard() from public,anon,authenticated;
create trigger receiving_running_guard before insert or update of status,operator_id,additional_operator_ids on public.receiving_tasks for each row execute function rls_internal.receiving_running_guard();
create or replace function rls_internal.receiving_start(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_stage uuid; v_others uuid[]; v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
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

 or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_receipts(id,supplier_id,manifest,trailer,dock,staging_id,po_number,created_by)
 values(p_id,(p_data->>'supplier_id')::uuid,btrim(p_data->>'manifest'),upper(btrim(p_data->>'trailer')),p_data->>'dock',v_stage,coalesce(btrim(p_data->>'po_number'),''),auth.uid());
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
 if not exists(select 1 from public.inventory_items where id=(v_line->>'item_id')::uuid and active and category in ('RAW','FG','PACKAGING')) then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_lines(receipt_id,item_id,lot,expected) values(p_id,(v_line->>'item_id')::uuid,upper(btrim(coalesce(v_line->>'lot',''))),(v_line->>'expected')::numeric);
 end loop;
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id,additional_operator_ids) values(p_id,p_id,'unload',v_operator,v_others);
 return p_id;
end $$;
create or replace function rls_internal.receiving_putaway_group(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric,p_operators jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line public.receiving_lines%rowtype; v_reserved numeric; v_others uuid[];
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_tasks where id=p_id and operator_id=auth.uid()) then return p_id; end if;
 v_others:=rls_internal.receiving_operators(auth.uid(),p_operators);
 select * into v_line from public.receiving_lines where id=p_line for update;
 if not found or not exists(select 1 from public.receiving_receipts where id=v_line.receipt_id and status='received') then raise exception 'receiving_invalid'; end if;
 select coalesce(sum(quantity),0) into v_reserved from public.receiving_tasks where line_id=p_line and status<>'cancelled';
 if p_quantity is null or p_quantity<=0 or p_quantity>v_line.received-v_reserved then raise exception 'receiving_quantity'; end if;
 if not exists(select 1 from public.receiving_locations where id=p_location and active and not is_system_stage) then raise exception 'receiving_location'; end if;
 if exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id)
 and not exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id and location_id=p_location) then raise exception 'receiving_location'; end if;
 insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id,additional_operator_ids)
 values(p_id,v_line.receipt_id,'putaway',p_line,p_location,p_quantity,auth.uid(),v_others);
 return p_id;
end $$;
create function public.receiving_putaway_group(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric,p_operators jsonb default '[]') returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_putaway_group($1,$2,$3,$4,$5); $$;
revoke all on function public.receiving_putaway_group(uuid,uuid,uuid,numeric,jsonb) from public,anon;
revoke all on function rls_internal.receiving_putaway_group(uuid,uuid,uuid,numeric,jsonb) from public,anon;
grant execute on function public.receiving_putaway_group(uuid,uuid,uuid,numeric,jsonb) to authenticated;
grant execute on function rls_internal.receiving_putaway_group(uuid,uuid,uuid,numeric,jsonb) to authenticated;
create or replace function rls_internal.receiving_putaway(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric) returns uuid language sql security definer set search_path='' as $$ select rls_internal.receiving_putaway_group($1,$2,$3,$4,'[]'); $$;
create or replace function rls_internal.receiving_task(p_id uuid,p_action text,p_lines jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_task public.receiving_tasks%rowtype; v_receipt public.receiving_receipts%rowtype;
 v_line public.receiving_lines%rowtype; v_data jsonb; v_area text; v_received numeric; v_damaged numeric; v_item record;
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 -- Consistent locking order with start/hold: receipt or line, then task.
 select * into v_task from public.receiving_tasks where id=p_id;
 if not found then raise exception 'receiving_invalid'; end if;
 if v_task.kind='putaway' then perform 1 from public.receiving_lines where id=v_task.line_id for update;
 else perform 1 from public.receiving_receipts where id=v_task.receipt_id for update; end if;
 select * into v_task from public.receiving_tasks where id=p_id for update;
 if v_task.operator_id<>auth.uid() and not (auth.uid()=any(v_task.additional_operator_ids)) and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if (v_task.status='finished' and p_action='finish') or (v_task.status='cancelled' and p_action='cancel')
 or (v_task.status='paused' and p_action='pause') or (v_task.status='running' and p_action='resume') then return p_id; end if;
 if v_task.status not in ('running','paused') then raise exception 'receiving_closed'; end if;
 if p_action='pause' and v_task.status='running' then
 update public.receiving_tasks set status='paused',paused_at=now() where id=p_id;
 elsif p_action='resume' and v_task.status='paused' then
 update public.receiving_tasks set status='running',pause_seconds=pause_seconds+extract(epoch from now()-paused_at),paused_at=null where id=p_id;
 elsif p_action in ('finish','cancel') then
 select * into v_receipt from public.receiving_receipts where id=v_task.receipt_id;
 if p_action='finish' and v_task.kind='unload' then
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<>(select count(*) from public.receiving_lines where receipt_id=v_receipt.id)
 or (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines)
 then raise exception 'receiving_invalid'; end if;
 for v_line in select * from public.receiving_lines where receipt_id=v_receipt.id for update loop
 select value into v_data from jsonb_array_elements(p_lines) where value->>'id'=v_line.id::text;
 v_received:=(v_data->>'received')::numeric; v_damaged:=(v_data->>'damaged')::numeric;
 if v_received is null or v_damaged is null or v_received<0 or v_damaged<0 or v_damaged>v_received
 or v_received::text in ('NaN','Infinity','-Infinity') or v_damaged::text in ('NaN','Infinity','-Infinity')
 or (v_damaged>0 and nullif(btrim(v_data->>'note'),'') is null) then raise exception 'receiving_quantity'; end if;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 update public.receiving_lines set received=v_received,damaged=v_damaged,note=coalesce(v_data->>'note','') where id=v_line.id;
 if v_received>0 then
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,note,created_by)
 select v_line.item_id,v_area,v_received,'RECEIPT',code,v_line.lot,'receiving:'||v_line.id,coalesce(v_data->>'note',''),auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 end if;
 end loop;
 update public.receiving_receipts set status='received',received_at=now() where id=v_receipt.id;
 elsif p_action='finish' and v_task.kind='putaway' then
 select * into v_line from public.receiving_lines where id=v_task.line_id;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 if exists(select 1 from public.inventory_quality_holds where id=v_line.hold_id and status='held') then v_area:='HOLD'; end if;
 -- Equal debit and credit: putaway never receives the stock a second time.
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,-v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-out:'||p_id,auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-in:'||p_id,auth.uid() from public.receiving_locations where id=v_task.location_id;
 elsif p_action='cancel' and v_task.kind='unload' then
 update public.receiving_receipts set status='cancelled' where id=v_receipt.id;
 end if;
 update public.receiving_tasks set status=case when p_action='finish' then 'finished' else 'cancelled' end,
 finished_at=now(),pause_seconds=pause_seconds+case when paused_at is not null then extract(epoch from now()-paused_at) else 0 end,paused_at=null where id=p_id;
 else raise exception 'receiving_invalid'; end if;
 return p_id;
end $$;
create or replace function rls_internal.receiving_users() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('uid',o.uid,'nombre',o.nombre,'activo',o.activo,'role',coalesce(m.role,'supervisor'),'assigned',coalesce(m.active,false)) order by o.nombre),'[]'::jsonb)
 from public.operadores o left join public.global_department_memberships m on m.user_id=o.uid and m.department='receiving'
 where (rls_internal.receiving_access() or rls_internal.inventory_access('quality'))
 and (m.user_id is not null or exists(select 1 from public.receiving_tasks where operator_id=o.uid or o.uid=any(additional_operator_ids)));
$$;
-- Only publish safe change notifications; unit_cost remains protected.
create table public.catalog_updates (id integer primary key check(id=1),version bigint not null default 0);
insert into public.catalog_updates values(1,0);
alter table public.catalog_updates enable row level security;
revoke all on public.catalog_updates from public,anon,authenticated;
grant select on public.catalog_updates to authenticated;
create policy catalog_updates_read on public.catalog_updates for select to authenticated using(rls_internal.catalog_access());
create function rls_internal.notify_catalog_update() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.catalog_updates set version=version+1 where id=1; return null; end $$;
revoke all on function rls_internal.notify_catalog_update() from public,anon,authenticated;
create trigger inventory_catalog_updated after insert or update or delete on public.inventory_items for each statement execute function rls_internal.notify_catalog_update();
do $$ declare v_table text; begin
 foreach v_table in array array['catalog_updates','receiving_suppliers','receiving_locations','receiving_material_types','receiving_item_types','receiving_item_locations','receiving_receipts','receiving_lines','receiving_tasks','inventory_movements','inventory_quality_holds','inventory_counts','inventory_count_lines','inventory_production_reports','inventory_boms','inventory_bom_lines','inventory_demand_imports','inventory_demand_lines','inventory_dispatches','global_department_memberships'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then execute format('alter publication supabase_realtime add table public.%I',v_table); end if;
 end loop;
end $$;
