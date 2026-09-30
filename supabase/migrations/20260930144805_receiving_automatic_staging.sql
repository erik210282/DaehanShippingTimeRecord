-- The receiving dock is automatic; operators select destinations only during putaway.
alter table public.receiving_locations add column is_system_stage boolean not null default false;
create unique index receiving_locations_system_stage on public.receiving_locations(is_system_stage) where is_system_stage;
do $$ declare v_code text:='RECEIVING'; begin
 if exists(select 1 from public.receiving_locations where code=v_code) then v_code:=v_code||'-'||substr(gen_random_uuid()::text,1,8); end if;
 insert into public.receiving_locations(code,name,area,kind,material_type,active,is_system_stage)
 values(v_code,'Receiving','RECEIVING','RECEIVING','RAW',true,true);
end $$;
create or replace function rls_internal.receiving_start(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_stage uuid; v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 if v_operator<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if not exists(select 1 from public.operadores o where o.uid=v_operator and o.activo and
 (exists(select 1 from public.global_department_memberships where user_id=v_operator and department='receiving' and active)
 or exists(select 1 from public.global_system_admins where user_id=v_operator))) then raise exception 'receiving_invalid_operator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_receipts where id=p_id and created_by=auth.uid()) then return p_id; end if;
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
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id) values(p_id,p_id,'unload',v_operator);
 return p_id;
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
 if exists(select 1 from public.receiving_locations where id=v_id and is_system_stage) then raise exception 'receiving_location'; end if;
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
 where not exists(select 1 from public.receiving_locations where id=value::uuid and active and not is_system_stage)) then raise exception 'receiving_location'; end if;
 insert into public.receiving_item_types(item_id,material_type) values(v_id,v_type.code) on conflict(item_id) do update set material_type=excluded.material_type;
 delete from public.receiving_item_locations where item_id=v_id;
 insert into public.receiving_item_locations(item_id,location_id)
 select v_id,value::uuid from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb))
 ;
 else raise exception 'receiving_invalid'; end if;
 return v_id;
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
 if not exists(select 1 from public.receiving_locations where id=p_location and active and not is_system_stage) then raise exception 'receiving_location'; end if;
 if exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id)
 and not exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id and location_id=p_location) then raise exception 'receiving_location'; end if;
 insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id)
 values(p_id,v_line.receipt_id,'putaway',p_line,p_location,p_quantity,auth.uid());
 return p_id;
end $$;
