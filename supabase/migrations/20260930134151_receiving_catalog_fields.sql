-- Preserve existing catalogs and receipts; material type is separate from physical use.
alter table public.receiving_suppliers
 add column street text not null default '', add column exterior_number text not null default '',
 add column interior_number text not null default '', add column neighborhood text not null default '',
 add column city text not null default '', add column state text not null default '',
 add column postal_code text not null default '', add column country text not null default '',
 add column phone text not null default '';
alter table public.receiving_receipts add column po_number text not null default '';
create table public.receiving_material_types (
 code text primary key check(code ~ '^[A-Z0-9_]+$'), name text not null check(length(btrim(name))>0),
 category text not null check(category in ('RAW','FG','PACKAGING','HOLD')),
 active boolean not null default true, builtin boolean not null default false
);
insert into public.receiving_material_types(code,name,category,builtin) values
 ('RAW','Materia prima','RAW',true),('FG','Producto terminado','FG',true),
 ('PACKAGING','Empaque','PACKAGING',true),('HOLD','Cuarentena','HOLD',true);
alter table public.receiving_locations add column material_type text not null default 'RAW' references public.receiving_material_types(code);
update public.receiving_locations set material_type='HOLD' where kind='QUALITY';
create index receiving_locations_material_type on public.receiving_locations(material_type);
create table public.receiving_item_types (
 item_id uuid primary key references public.inventory_items(id),
 material_type text not null references public.receiving_material_types(code)
);
create index receiving_item_types_material_type on public.receiving_item_types(material_type);
insert into public.receiving_item_types(item_id,material_type) select id,category from public.inventory_items where category in ('RAW','PACKAGING') or responsible_department='receiving';
do $$ declare v_table text; begin
 foreach v_table in array array['receiving_material_types','receiving_item_types'] loop
 execute format('alter table public.%I enable row level security',v_table);
 execute format('revoke all on public.%I from public,anon,authenticated',v_table);
 execute format('grant select on public.%I to authenticated',v_table);
 execute format('create policy receiving_read on public.%I for select to authenticated using (rls_internal.receiving_access() or rls_internal.inventory_access(''quality''))',v_table);
 end loop;
end $$;
create or replace function rls_internal.receiving_catalog(p_kind text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_type public.receiving_material_types%rowtype; v_code text; v_id uuid := coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
begin
 if not rls_internal.receiving_access(true) then raise exception 'receiving_forbidden'; end if;
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
 select * into v_type from public.receiving_material_types where code=coalesce(p_data->>'material_type','RAW') and active;
 if not found then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_locations(id,code,name,area,kind,material_type,active) values(v_id,upper(btrim(p_data->>'code')),btrim(p_data->>'name'),coalesce(p_data->>'area',''),coalesce(p_data->>'kind',case when v_type.category='HOLD' then 'QUALITY' else 'STORAGE' end),v_type.code,coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set code=excluded.code,name=excluded.name,area=excluded.area,kind=excluded.kind,material_type=excluded.material_type,active=excluded.active;
 elsif p_kind='item' then
 select * into v_type from public.receiving_material_types where code=coalesce(p_data->>'material_type',p_data->>'category') and active and category<>'HOLD';
 if not found then raise exception 'receiving_invalid'; end if;
 p_data:=p_data || jsonb_build_object('category',v_type.category);
 if p_data->>'category' not in ('RAW','FG','PACKAGING') or nullif(btrim(p_data->>'uom'),'') is null
 or exists(select 1 from public.inventory_items where id=v_id and producto_id is not null) then raise exception 'receiving_invalid'; end if;
 if exists(select 1 from public.inventory_items where id=v_id and (category<>p_data->>'category' or uom<>upper(btrim(p_data->>'uom'))))
 and (exists(select 1 from public.inventory_movements where item_id=v_id) or exists(select 1 from public.receiving_lines where item_id=v_id)) then raise exception 'receiving_item_locked'; end if;
 insert into public.inventory_items(id,part_number,description,category,uom,responsible_department,active)
 values(v_id,upper(btrim(p_data->>'part_number')),coalesce(p_data->>'description',''),p_data->>'category',upper(btrim(p_data->>'uom')),'receiving',coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set part_number=excluded.part_number,description=excluded.description,category=excluded.category,uom=excluded.uom,active=excluded.active;
 if jsonb_typeof(coalesce(p_data->'locations','[]'::jsonb)) is distinct from 'array'
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb)) a(value)
 where not exists(select 1 from public.receiving_locations where id=value::uuid and active)) then raise exception 'receiving_location'; end if;
 insert into public.receiving_item_types(item_id,material_type) values(v_id,v_type.code) on conflict(item_id) do update set material_type=excluded.material_type;
 delete from public.receiving_item_locations where item_id=v_id;
 insert into public.receiving_item_locations(item_id,location_id)
 select v_id,value::uuid from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb))
 ;
 else raise exception 'receiving_invalid'; end if;
 return v_id;
end $$;
create or replace function rls_internal.receiving_start(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 if v_operator<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if not exists(select 1 from public.operadores o where o.uid=v_operator and o.activo and
 (exists(select 1 from public.global_department_memberships where user_id=v_operator and department='receiving' and active)
 or exists(select 1 from public.global_system_admins where user_id=v_operator))) then raise exception 'receiving_invalid_operator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_receipts where id=p_id and created_by=auth.uid()) then return p_id; end if;
 if not exists(select 1 from public.receiving_suppliers where id=(p_data->>'supplier_id')::uuid and active)
 or not exists(select 1 from public.receiving_locations where id=(p_data->>'staging_id')::uuid and active)
 or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_receipts(id,supplier_id,manifest,trailer,dock,staging_id,po_number,created_by)
 values(p_id,(p_data->>'supplier_id')::uuid,btrim(p_data->>'manifest'),upper(btrim(p_data->>'trailer')),p_data->>'dock',(p_data->>'staging_id')::uuid,coalesce(btrim(p_data->>'po_number'),''),auth.uid());
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
 if not exists(select 1 from public.inventory_items where id=(v_line->>'item_id')::uuid and active and category in ('RAW','FG','PACKAGING')) then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_lines(receipt_id,item_id,lot,expected) values(p_id,(v_line->>'item_id')::uuid,upper(btrim(coalesce(v_line->>'lot',''))),(v_line->>'expected')::numeric);
 end loop;
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id) values(p_id,p_id,'unload',v_operator);
 return p_id;
end $$;
create or replace function rls_internal.receiving_putaway(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line public.receiving_lines%rowtype; v_reserved numeric;
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_tasks where id=p_id and operator_id=auth.uid()) then return p_id; end if;
 select * into v_line from public.receiving_lines where id=p_line for update;
 if not found or not exists(select 1 from public.receiving_receipts where id=v_line.receipt_id and status='received') then raise exception 'receiving_invalid'; end if;
 select coalesce(sum(quantity),0) into v_reserved from public.receiving_tasks where line_id=p_line and status<>'cancelled';
 if p_quantity is null or p_quantity<=0 or p_quantity>v_line.received-v_reserved then raise exception 'receiving_quantity'; end if;
 if not exists(select 1 from public.receiving_locations where id=p_location and active) then raise exception 'receiving_location'; end if;
 if exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id)
 and not exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id and location_id=p_location) then raise exception 'receiving_location'; end if;
 insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id)
 values(p_id,v_line.receipt_id,'putaway',p_line,p_location,p_quantity,auth.uid());
 return p_id;
end $$;
