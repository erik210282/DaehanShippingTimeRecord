alter table public.inventory_items add column packing_type text check(packing_type in ('returnable','expendable'));
grant select(packing_type) on public.inventory_items to authenticated;
alter table public.production_station_reports add column rework_completed boolean not null default false,add column catalog_packing boolean not null default false,add column packing_item_id uuid references public.inventory_items(id),add column packing_box_name text;
alter table public.production_station_reports alter column good_quantity set expression as (machine_quantity-scrap_quantity+case when rework_completed then rework_quantity else -rework_quantity end);
alter table public.production_station_reports drop constraint production_station_reports_check,drop constraint production_station_reports_check1;
alter table public.production_station_reports add constraint production_station_reports_output_check check(scrap_quantity<=machine_quantity and good_quantity>=0),add constraint production_station_reports_packed_check check(full_boxes*pieces_per_box<=good_quantity);
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
 packing_type=case when v_type.category='PACKAGING' and p_data ? 'packing_type' then nullif(p_data->>'packing_type','') else packing_type end,
 packing_weight=case when v_type.category='PACKAGING' and p_data ? 'packing_weight' then nullif(p_data->>'packing_weight','')::numeric else packing_weight end,
 packing_weight_unit=case when v_type.category='PACKAGING' and p_data ? 'packing_weight_unit' then p_data->>'packing_weight_unit' else packing_weight_unit end,
 packing_measures=case when v_type.category='PACKAGING' and p_data ? 'packing_measures' then nullif(btrim(p_data->>'packing_measures'),'') else packing_measures end,
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
create or replace function rls_internal.production_packing_profile(p_item uuid,p_type text,p_bom uuid)
returns jsonb language plpgsql set search_path='' as $function$
declare product public.productos%rowtype;profile public.inventory_bom_packaging%rowtype;box public.inventory_items%rowtype;box_ref text;capacity numeric;
begin
 if p_type is null or p_type not in ('returnable','expendable') then return null;end if;
 select p.* into product from public.productos p join public.inventory_items i on i.producto_id=p.id where i.id=p_item for share of p;
 select * into profile from public.inventory_bom_packaging where bom_id=p_bom and packaging_type=p_type;
 box_ref:=case when p_type='returnable' then product.tipo_empaque_retornable else product.tipo_empaque_expendable end;
 capacity:=case when p_type='returnable' then product.cantidad_por_caja_retornable else product.cantidad_por_caja_expendable end;
 if nullif(btrim(box_ref),'') is not null then
  select * into box from public.inventory_items where category='PACKAGING' and active and packing_type=p_type and
   (upper(btrim(part_number))=upper(btrim(box_ref)) or id::text=box_ref or upper(btrim(part_name))=upper(btrim(box_ref))) order by (upper(btrim(part_number))=upper(btrim(box_ref))) desc,id limit 1 for share;
  if capacity is null or capacity<=0 or capacity<>trunc(capacity) then return null;end if;
  if box.id is null and profile.bom_id is null then return null;end if;
 else
  if profile.bom_id is null then return null;end if;
  capacity:=profile.pieces_per_box;
 end if;
 return jsonb_build_object('packaging_type',p_type,'pieces_per_box',capacity,'box_name',coalesce(box.part_name,nullif(box_ref,''),profile.box_name),'packing_item_id',box.id,'boxes_per_pallet',profile.boxes_per_pallet);
end $function$;
revoke all on function rls_internal.production_packing_profile(uuid,text,uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=(p_data->>'id')::uuid;v_old public.production_station_reports%rowtype;v_report public.production_station_reports%rowtype;v_station public.inventory_workstations%rowtype;v_item public.inventory_items%rowtype;v_bom public.inventory_boms%rowtype;v_profile public.inventory_bom_packaging%rowtype;v_row record;v_elapsed numeric;v_repack boolean;v_ledger uuid;v_qty numeric;v_balance numeric;v_can_manage boolean;v_packing jsonb;v_good integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if v_id is null then raise exception 'pr_invalid';end if;
 v_can_manage:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 perform pg_advisory_xact_lock(hashtextextended('station-report:'||v_id,0));
 select * into v_old from public.production_station_reports where id=v_id for update;
 if v_old.id is not null and v_old.created_by<>auth.uid() and not v_can_manage then raise exception 'pr_forbidden';end if;
 if p_action='delete' then
  if v_old.id is null or v_old.status<>'draft' then raise exception 'pr_locked';end if;
  delete from public.production_station_reports where id=v_id;return v_id;
 end if;
 if p_action in ('save','submit') then
  if v_old.status in ('posted','submitted') then raise exception 'pr_locked';end if;
  select * into v_station from public.inventory_workstations where code=p_data->>'station_code' and active;
  if not found then raise exception 'pr_station_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('production-station:'||v_station.code,0));
  select * into v_item from public.inventory_items where id=(p_data->>'item_id')::uuid and active;
  if not found then raise exception 'pr_item_required';end if;
  select * into v_bom from public.inventory_boms where finished_item_id=v_item.id and active and not archived;
  v_report:=jsonb_populate_record(null::public.production_station_reports,p_data);
  v_report.rework_completed:=coalesce((p_data->>'rework_completed')::boolean,v_old.rework_completed,false);v_report.catalog_packing:=coalesce((p_data->>'catalog_packing')::boolean,v_old.catalog_packing,false);
  v_good:=v_report.machine_quantity-v_report.scrap_quantity+case when v_report.rework_completed then v_report.rework_quantity else -v_report.rework_quantity end;
  v_elapsed:=extract(epoch from (v_report.end_time-v_report.start_time))/60+case when v_report.ends_next_day then 1440 else 0 end;
  if v_report.production_date is null or v_report.start_time is null or v_report.end_time is null or v_elapsed<=0 or v_elapsed>1440 or v_report.production_date>current_date+1 or v_report.people is null or v_report.people<=0 or v_report.machine_minutes is null or v_report.machine_minutes<0 or v_report.downtime_minutes is null or v_report.downtime_minutes<0 or v_report.break_minutes is null or v_report.break_minutes<0 or v_report.machine_minutes+v_report.downtime_minutes+v_report.break_minutes>v_elapsed or v_report.break_count is null or v_report.break_count<0 or (v_report.break_count=0)<>(v_report.break_minutes=0) or (v_report.downtime_minutes>0 and nullif(btrim(v_report.downtime_reason),'') is null) or v_report.report_mode not in ('production','packing') then raise exception 'pr_time_invalid';end if;
  if v_report.machine_quantity is null or v_report.scrap_quantity is null or v_report.rework_quantity is null or v_report.full_boxes is null or v_report.pallets is null or least(v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.full_boxes,v_report.pallets)<0 or v_report.scrap_quantity>v_report.machine_quantity or v_good<0 then raise exception 'pr_quantity_invalid';end if;
  if v_station.name ~* '(turn[ ]?table|t/t)' and (v_report.turns is null or v_report.turns<0) then raise exception 'pr_turns_required';end if;
  if v_report.full_boxes>0 then
   if v_item.category<>'FG' then raise exception 'pr_pack_invalid';end if;
   select * into v_profile from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_report.packaging_type;
   if v_report.catalog_packing then
    v_packing:=rls_internal.production_packing_profile(v_item.id,v_report.packaging_type,v_bom.id);
    if v_packing is null then raise exception 'pr_pack_catalog_required';end if;
    v_report.pieces_per_box:=(v_packing->>'pieces_per_box')::integer;
    v_report.packing_item_id:=(v_packing->>'packing_item_id')::uuid;v_report.packing_box_name:=v_packing->>'box_name';
   else
    if v_profile.bom_id is null then raise exception 'pr_pack_missing';end if;
    v_report.pieces_per_box:=v_profile.pieces_per_box;
   end if;
   if v_report.full_boxes*v_report.pieces_per_box>v_good then raise exception 'pr_quantity_invalid';end if;
   if exists(select 1 from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_profile.packaging_type and basis='pallet') and v_report.pallets<=0 then raise exception 'pr_pallets_required';end if;
  else v_report.pieces_per_box:=0;v_report.packaging_type:=null;if v_report.pallets<>0 then raise exception 'pr_quantity_invalid';end if;end if;
  if p_action='submit' then
   if v_bom.id is null or not exists(select 1 from public.inventory_bom_lines where bom_id=v_bom.id) then raise exception 'pr_recipe_missing';end if;
   if v_item.category not in ('FG','SEMI') then raise exception 'pr_output_required';end if;
   if exists(select 1 from public.production_station_reports r where r.id<>v_id and r.station_code=v_station.code and r.status in ('submitted','posted') and tsrange(r.production_date+r.start_time,r.production_date+r.end_time+case when r.ends_next_day then interval '1 day' else interval '0' end,'[)') && tsrange(v_report.production_date+v_report.start_time,v_report.production_date+v_report.end_time+case when v_report.ends_next_day then interval '1 day' else interval '0' end,'[)')) then raise exception 'pr_overlap';end if;
  end if;
  insert into public.production_station_reports(id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,downtime_reason,break_count,break_minutes,people,machine_quantity,scrap_quantity,rework_quantity,packaging_type,full_boxes,pallets,pieces_per_box,turns,report_mode,note,status,created_by,rework_completed,catalog_packing,packing_item_id,packing_box_name)
  values(v_id,v_station.code,v_item.id,v_bom.id,v_report.production_date,v_report.start_time,v_report.end_time,v_report.ends_next_day,v_elapsed,v_report.machine_minutes,v_report.downtime_minutes,coalesce(v_report.downtime_reason,''),v_report.break_count,v_report.break_minutes,v_report.people,v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.packaging_type,v_report.full_boxes,v_report.pallets,v_report.pieces_per_box,v_report.turns,v_report.report_mode,coalesce(v_report.note,''),case when p_action='submit' then 'submitted' else 'draft' end,coalesce(v_old.created_by,auth.uid()),v_report.rework_completed,v_report.catalog_packing,v_report.packing_item_id,v_report.packing_box_name)
  on conflict(id) do update set rework_completed=excluded.rework_completed,catalog_packing=excluded.catalog_packing,packing_item_id=excluded.packing_item_id,packing_box_name=excluded.packing_box_name,station_code=excluded.station_code,item_id=excluded.item_id,bom_id=excluded.bom_id,production_date=excluded.production_date,start_time=excluded.start_time,end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,downtime_reason=excluded.downtime_reason,break_count=excluded.break_count,break_minutes=excluded.break_minutes,people=excluded.people,machine_quantity=excluded.machine_quantity,scrap_quantity=excluded.scrap_quantity,rework_quantity=excluded.rework_quantity,packaging_type=excluded.packaging_type,full_boxes=excluded.full_boxes,pallets=excluded.pallets,pieces_per_box=excluded.pieces_per_box,turns=excluded.turns,report_mode=excluded.report_mode,note=excluded.note,status=excluded.status,updated_at=now();
  return v_id;
 end if;
 if p_action='return' then
  if not public.inventory_access('production',true) or v_old.status<>'submitted' then raise exception 'pr_forbidden';end if;
  update public.production_station_reports set status='draft',updated_at=now() where id=v_id;return v_id;
 end if;
 if p_action<>'post' or not public.inventory_access('production',true) or v_old.id is null then raise exception 'pr_forbidden';end if;
 if v_old.status='posted' then return v_id;end if;
 if v_old.status<>'submitted' then raise exception 'pr_locked';end if;
 select * into v_bom from public.inventory_boms where id=v_old.bom_id and active and not archived for share;
 if not found then raise exception 'pr_recipe_changed';end if;
 select * into v_item from public.inventory_items where id=v_old.item_id and active;
 if not found then raise exception 'pr_item_required';end if;
 if not exists(select 1 from public.inventory_workstations where code=v_old.station_code and active) then raise exception 'pr_station_required';end if;
 v_repack:=exists(select 1 from public.inventory_bom_lines l where l.bom_id=v_bom.id and l.ingredient_id=v_item.id);
 if v_old.report_mode='packing' then
  if v_repack or v_old.scrap_quantity<>0 or v_old.rework_quantity<>0 or v_old.good_quantity<>v_old.packed_quantity or v_old.packed_quantity<=0 then raise exception 'pr_packing_only_invalid';end if;
  insert into public.production_station_consumptions values(v_id,v_item.id,'WIP','wip',v_old.packed_quantity);
 elsif v_repack then
  if v_old.good_quantity<>v_old.packed_quantity or v_old.rework_quantity<>0 then raise exception 'pr_repack_boxes';end if;
  if v_old.machine_quantity>0 then insert into public.production_station_consumptions values(v_id,v_item.id,'FG','repack',v_old.machine_quantity);end if;
 else
  insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
   select v_id,l.ingredient_id,case when i.category='SEMI' then 'WIP' else i.category end,'manufacturing',v_old.machine_quantity*l.quantity_per_unit*(1+l.waste_rate)
   from public.inventory_bom_lines l join public.inventory_items i on i.id=l.ingredient_id where l.bom_id=v_bom.id and v_old.machine_quantity>0;
 end if;
 if v_old.full_boxes>0 then
  if v_old.catalog_packing then
   v_packing:=rls_internal.production_packing_profile(v_item.id,v_old.packaging_type,v_bom.id);
   if v_packing is null or (v_packing->>'pieces_per_box')::integer<>v_old.pieces_per_box or (v_packing->>'packing_item_id')::uuid is distinct from v_old.packing_item_id then raise exception 'pr_recipe_changed';end if;
  elsif not exists(select 1 from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_old.packaging_type and pieces_per_box=v_old.pieces_per_box) then raise exception 'pr_recipe_changed';end if;
  insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
   select v_id,ingredient_id,'PACKAGING','packing',sum(quantity*(1+waste_rate)*case basis when 'piece' then v_old.packed_quantity when 'box' then v_old.full_boxes when 'pallet' then v_old.pallets end)
   from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_old.packaging_type group by ingredient_id;
  if v_old.packing_item_id is not null and not exists(select 1 from public.production_station_consumptions where report_id=v_id and ingredient_id=v_old.packing_item_id) then
   insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity) values(v_id,v_old.packing_item_id,'PACKAGING','packing',v_old.full_boxes);
  end if;
  if not exists(select 1 from public.production_station_consumptions where report_id=v_id and source='packing') then raise exception 'pr_pack_missing';end if;
 end if;
 -- Lock each item in a consistent order; physical inventory remains untouched on failure.
 for v_row in select distinct ingredient_id from public.production_station_consumptions where report_id=v_id order by ingredient_id loop
  perform 1 from public.inventory_items where id=v_row.ingredient_id and active for update;
  if not found then raise exception 'catalog_recipe_ingredient';end if;
 end loop;
 for v_row in select ingredient_id,area,sum(quantity) quantity from public.production_station_consumptions where report_id=v_id group by ingredient_id,area loop
  select coalesce(sum(quantity_delta),0) into v_balance from public.inventory_movements where item_id=v_row.ingredient_id and area=v_row.area;
  if v_balance<v_row.quantity then raise exception 'pr_stock_short';end if;
 end loop;
 if v_old.report_mode='production' and v_old.machine_quantity>0 then
  insert into public.inventory_production_reports(item_id,bom_id,production_date,good_quantity,waste_quantity,note,created_by)
   values(v_item.id,v_bom.id,v_old.production_date,v_old.good_quantity+case when v_old.rework_completed then 0 else v_old.rework_quantity end,v_old.scrap_quantity,v_old.note,v_old.created_by) returning id into v_ledger;
  insert into public.inventory_production_inputs(report_id,ingredient_id,theoretical_quantity)
   select v_ledger,ingredient_id,sum(quantity) from public.production_station_consumptions where report_id=v_id group by ingredient_id;
 end if;
 for v_row in select * from public.production_station_consumptions where report_id=v_id loop
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
   values(v_row.ingredient_id,v_row.area,-v_row.quantity,'CONSUMPTION','station-input:'||v_id||':'||v_row.ingredient_id||':'||v_row.source,'Production '||v_id,v_old.production_date,auth.uid());
 end loop;
 if v_old.packed_quantity>0 then
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by) values(v_item.id,'FG',v_old.packed_quantity,'PRODUCTION','station-fg:'||v_id,v_old.note,v_old.production_date,auth.uid());
 end if;
 if not v_repack and v_old.report_mode='production' and v_old.good_quantity>v_old.packed_quantity then
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by) values(v_item.id,'WIP',v_old.good_quantity-v_old.packed_quantity,'WIP_IN','station-wip:'||v_id,v_old.note,v_old.production_date,auth.uid());
 end if;
 update public.production_station_reports set status='posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now(),inventory_report_id=v_ledger where id=v_id;
 return v_id;
end $function$
;
notify pgrst,'reload schema';