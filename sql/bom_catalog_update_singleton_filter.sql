CREATE OR REPLACE FUNCTION rls_internal.inventory_catalog_recipe(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=nullif(p_data->>'id','')::uuid;v_part text;v_item uuid;v_version integer;v_line jsonb;v_qty numeric;v_waste numeric;v_active boolean;v_pack jsonb;v_ing public.inventory_items%rowtype;v_repack boolean:=false;
begin
 if auth.uid() is null or not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden';end if;
 if p_action='delete' then
  perform 1 from public.inventory_boms where id=v_id for update;
  if not found then raise exception 'catalog_not_found';end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) or exists(select 1 from public.production_station_reports where bom_id=v_id) then
   update public.inventory_boms set active=false,archived=true where id=v_id;
  else delete from public.inventory_boms where id=v_id;end if;
  update public.catalog_updates set version=version+1 where id=1;
  return v_id;
 end if;
 if p_action<>'save' then raise exception 'receiving_invalid';end if;
 v_part:=upper(btrim(p_data->>'product_part_number'));
 if v_part is null or v_part='' or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'catalog_recipe_required';end if;
 select id into v_item from public.inventory_items where category in ('FG','SEMI') and part_number=v_part;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||v_part,0));
 if v_id is not null then
  perform 1 from public.inventory_boms where id=v_id and not archived for update;
  if not found then raise exception 'catalog_not_found';end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) or exists(select 1 from public.production_station_reports where bom_id=v_id and status in ('submitted','posted')) then raise exception 'catalog_recipe_used';end if;
 end if;
 v_version:=nullif(p_data->>'version','')::integer;
 if v_version is null then select coalesce(max(version),0)+1 into v_version from public.inventory_boms where product_part_number=v_part;end if;
 if v_version<1 then raise exception 'receiving_invalid';end if;
 v_active:=coalesce((p_data->>'active')::boolean,true);
 -- The only FG ingredient allowed is this recipe's own output, alone and at 1:1.
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  select * into v_ing from public.inventory_items where id=(v_line->>'ingredient_id')::uuid and active;
  if not found or v_ing.category not in ('RAW','PACKAGING','SEMI','FG') then raise exception 'catalog_recipe_ingredient';end if;
  if v_ing.category='FG' then
   if v_ing.id is distinct from v_item or jsonb_array_length(p_data->'lines')<>1 or (v_line->>'quantity_per_unit')::numeric<>1 or coalesce((v_line->>'waste_rate')::numeric,0)<>0 then raise exception 'pr_repack_exclusive';end if;
   v_repack:=true;
  elsif v_ing.id=v_item then raise exception 'pr_repack_exclusive';end if;
 end loop;
 if v_active then update public.inventory_boms set active=false where product_part_number=v_part and active and id is distinct from v_id;end if;
 if v_id is null then
  insert into public.inventory_boms(finished_item_id,product_part_number,version,active,notes,created_by)
   values(v_item,v_part,v_version,v_active,nullif(p_data->>'notes',''),auth.uid()) returning id into v_id;
 else
  update public.inventory_boms set finished_item_id=v_item,product_part_number=v_part,version=v_version,active=v_active,notes=nullif(p_data->>'notes','') where id=v_id;
  delete from public.inventory_bom_lines where bom_id=v_id;
 end if;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  v_qty:=(v_line->>'quantity_per_unit')::numeric;v_waste:=coalesce((v_line->>'waste_rate')::numeric,0);
  if v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_waste<0 or v_waste>=1 or v_waste::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity';end if;
  insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit,waste_rate) values(v_id,(v_line->>'ingredient_id')::uuid,v_qty,v_waste);
 end loop;
 if p_data ? 'packaging' then
  if jsonb_typeof(p_data->'packaging') is distinct from 'array' then raise exception 'pr_pack_invalid';end if;
  delete from public.inventory_bom_packaging where bom_id=v_id;
  for v_pack in select value from jsonb_array_elements(p_data->'packaging') loop
   if (v_pack->>'packaging_type' is null or (v_pack->>'packaging_type' not in ('returnable','expendable') and v_pack->>'packaging_type' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) or (v_pack->>'box_name' is null or v_pack->>'box_name' not in ('Returnable','Expendable')) or coalesce((v_pack->>'pieces_per_box')::integer,0)<=0 or jsonb_typeof(v_pack->'lines') is distinct from 'array' or jsonb_array_length(v_pack->'lines')=0 then raise exception 'pr_pack_invalid';end if;
   if exists(select 1 from jsonb_array_elements(v_pack->'lines') l where l->>'basis'='pallet') and coalesce(nullif(v_pack->>'boxes_per_pallet','')::integer,0)<=0 then raise exception 'pr_pallet_capacity';end if;
   insert into public.inventory_bom_packaging(bom_id,packaging_type,pieces_per_box,box_name,boxes_per_pallet) values(v_id,v_pack->>'packaging_type',(v_pack->>'pieces_per_box')::integer,btrim(v_pack->>'box_name'),nullif(v_pack->>'boxes_per_pallet','')::integer);
   for v_line in select value from jsonb_array_elements(v_pack->'lines') loop
    v_qty:=(v_line->>'quantity')::numeric;v_waste:=coalesce((v_line->>'waste_rate')::numeric,0);
    if not exists(select 1 from public.inventory_items where id=(v_line->>'ingredient_id')::uuid and active and category='PACKAGING') or v_line->>'basis' not in ('piece','box','pallet') or v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_waste<0 or v_waste>=1 or v_waste::text in ('NaN','Infinity','-Infinity') then raise exception 'pr_pack_invalid';end if;
    if exists(select 1 from public.inventory_bom_lines where bom_id=v_id and ingredient_id=(v_line->>'ingredient_id')::uuid) then raise exception 'pr_pack_duplicate';end if;
    insert into public.inventory_bom_packaging_lines(bom_id,packaging_type,ingredient_id,quantity,basis,waste_rate)
     values(v_id,v_pack->>'packaging_type',(v_line->>'ingredient_id')::uuid,v_qty,v_line->>'basis',v_waste);
   end loop;
  end loop;
 end if;
 update public.catalog_updates set version=version+1 where id=1;
 return v_id;
end $function$
;
