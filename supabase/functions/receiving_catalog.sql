CREATE OR REPLACE FUNCTION rls_internal.receiving_catalog(p_kind text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target_recipe public.inventory_boms%rowtype; v_recipe public.inventory_boms%rowtype; v_recipe_lines jsonb; v_type public.receiving_material_types%rowtype; v_code text; v_product public.productos%rowtype; v_product_id uuid; v_min numeric; v_supplier uuid; v_lead integer; v_name text; v_existing public.inventory_items%rowtype; v_shipping jsonb; v_key text; v_id uuid := coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
begin
 if not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden'; end if;
 if p_kind in ('material','supplier','location') then
  v_code:=upper(btrim(p_data->>'code'));
  if v_code is null or v_code='' then raise exception 'catalog_identifier_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:'||p_kind||':'||v_code,0));
  if coalesce((p_data->>'is_new')::boolean,false) and (
   (p_kind='material' and exists(select 1 from public.receiving_material_types where upper(btrim(code))=v_code))
   or (p_kind='supplier' and exists(select 1 from public.receiving_suppliers where upper(btrim(code))=v_code))
   or (p_kind='location' and exists(select 1 from public.receiving_locations where upper(btrim(code))=v_code))
  ) then raise exception 'catalog_duplicate_identifier'; end if;
 end if;
 if nullif(p_data->>'copy_recipe_from_part','') is not null then
  if p_kind<>'item' or not coalesce((p_data->>'is_new')::boolean,false)
   or nullif(p_data->>'id','') is not null or nullif(p_data->>'producto_id','') is not null
   or upper(btrim(p_data->>'part_number'))='NA'
   then raise exception 'receiving_invalid'; end if;
  select b.* into v_recipe from public.inventory_boms b
  where b.product_part_number=upper(btrim(p_data->>'copy_recipe_from_part')) and b.active and not b.archived
  and exists(select 1 from public.inventory_bom_lines l where l.bom_id=b.id)
  order by b.version desc limit 1 for share;
  if not found then raise exception 'catalog_source_recipe_missing'; end if;
  select jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'quantity_per_unit',quantity_per_unit,'waste_rate',waste_rate) order by ingredient_id)
   into v_recipe_lines from public.inventory_bom_lines where bom_id=v_recipe.id;
 end if;
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
 v_supplier:=case when p_data ? 'supplier_id' then nullif(p_data->>'supplier_id','')::uuid else v_existing.supplier_id end;
 if v_supplier is not null and not exists(select 1 from public.receiving_suppliers where id=v_supplier and (active or v_supplier=v_existing.supplier_id)) then raise exception 'receiving_invalid'; end if;
 if nullif(p_data->>'lead_time_days','') is not null and (p_data->>'lead_time_days') !~ '^[0-9]+$' then raise exception 'catalog_lead_time'; end if;
 v_lead:=case when p_data ? 'lead_time_days' then nullif(p_data->>'lead_time_days','')::integer else v_existing.lead_time_days end;
 v_name:=coalesce(nullif(btrim(p_data->>'part_name'),''),v_existing.part_name,nullif(p_data->>'description',''),'');
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
 update public.inventory_items set minimum_quantity=v_min,uom=upper(btrim(p_data->>'uom')),responsible_department='shipping',default_location=p_data->>'default_location' where id=v_id;
 else
 insert into public.inventory_items(id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active)
 values(v_id,upper(btrim(p_data->>'part_number')),coalesce(p_data->>'description',''),v_type.category,upper(btrim(p_data->>'uom')),v_min,'receiving',p_data->>'default_location',coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set part_number=excluded.part_number,description=excluded.description,category=excluded.category,uom=excluded.uom,minimum_quantity=excluded.minimum_quantity,responsible_department=excluded.responsible_department,default_location=excluded.default_location,active=excluded.active;
 end if;
 update public.inventory_items set part_name=case when v_type.category='FG' then coalesce(v_shipping->>'nombre',v_name) else v_name end,
 supplier_id=case when v_type.category='RAW' then v_supplier else null end,
 lead_time_days=case when v_type.category='RAW' then v_lead else null end where id=v_id;
 if jsonb_typeof(coalesce(p_data->'locations','[]'::jsonb)) is distinct from 'array'
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb)) a(value)
 where not exists(select 1 from public.receiving_locations where id=value::uuid and active and not is_system_stage)) then raise exception 'receiving_location'; end if;
 insert into public.receiving_item_types(item_id,material_type) values(v_id,v_type.code) on conflict(item_id) do update set material_type=excluded.material_type;
 delete from public.receiving_item_locations where item_id=v_id;
 insert into public.receiving_item_locations(item_id,location_id)
 select v_id,value::uuid from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb))
 ;
 else raise exception 'receiving_invalid'; end if;

 if v_recipe.id is not null then
  if v_type.category<>'FG' then raise exception 'receiving_invalid'; end if;
  select b.* into v_target_recipe from public.inventory_boms b
   where b.product_part_number=upper(btrim(p_data->>'part_number')) and b.active and not b.archived
   and exists(select 1 from public.inventory_bom_lines l where l.bom_id=b.id)
   order by b.version desc limit 1 for update;
  if v_target_recipe.id is not null then
   if exists(
    (select ingredient_id,quantity_per_unit,waste_rate from public.inventory_bom_lines where bom_id=v_recipe.id)
    except (select ingredient_id,quantity_per_unit,waste_rate from public.inventory_bom_lines where bom_id=v_target_recipe.id)
   ) or exists(
    (select ingredient_id,quantity_per_unit,waste_rate from public.inventory_bom_lines where bom_id=v_target_recipe.id)
    except (select ingredient_id,quantity_per_unit,waste_rate from public.inventory_bom_lines where bom_id=v_recipe.id)
   ) then raise exception 'catalog_target_recipe_differs'; end if;
   if v_target_recipe.finished_item_id is not null and v_target_recipe.finished_item_id<>v_id then raise exception 'catalog_duplicate_identifier'; end if;
   update public.inventory_boms set finished_item_id=v_id where id=v_target_recipe.id;
  else
   perform rls_internal.inventory_catalog_recipe('save',jsonb_build_object(
    'product_part_number',upper(btrim(p_data->>'part_number')),'active',true,
    'notes','Receta duplicada desde '||v_recipe.product_part_number,'lines',v_recipe_lines));
  end if;
 end if;
 return v_id;
end $function$
;
