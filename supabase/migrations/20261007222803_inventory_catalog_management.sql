
begin;
alter table public.receiving_suppliers add column if not exists archived boolean not null default false;
alter table public.receiving_locations add column if not exists archived boolean not null default false;
alter table public.receiving_material_types add column if not exists archived boolean not null default false;
alter table public.inventory_boms alter column finished_item_id drop not null;
alter table public.inventory_boms add column if not exists product_part_number text;
alter table public.inventory_boms add column if not exists archived boolean not null default false;
update public.inventory_boms b set product_part_number=i.part_number from public.inventory_items i where b.finished_item_id=i.id and b.product_part_number is null;
create unique index if not exists inventory_boms_part_version on public.inventory_boms(product_part_number,version);
create policy inventory_workstations_manage on public.inventory_workstations for all to authenticated using (rls_internal.catalog_access(true)) with check (rls_internal.catalog_access(true));
create policy inventory_workstations_catalog_read on public.inventory_workstations for select to authenticated using (rls_internal.catalog_access());
grant select,insert,update,delete on public.inventory_workstations to authenticated;
revoke all on public.inventory_workstations from anon;
create or replace function rls_internal.catalog_remove(p_kind text,p_key text) returns text language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_used boolean;
begin
 if not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden'; end if;
 if p_kind='supplier' then
  v_id:=p_key::uuid;
  v_used:=exists(select 1 from public.receiving_receipts where supplier_id=v_id);
  update public.inventory_items set supplier_id=null where supplier_id=v_id and category<>'FG';
  if v_used then update public.receiving_suppliers set active=false,archived=true where id=v_id;
  else delete from public.receiving_suppliers where id=v_id; end if;
 elsif p_kind='location' then
  v_id:=p_key::uuid;
  if exists(select 1 from public.receiving_locations where id=v_id and is_system_stage) then raise exception 'receiving_location'; end if;
  v_used:=exists(select 1 from public.receiving_receipts where staging_id=v_id) or exists(select 1 from public.receiving_tasks where location_id=v_id);
  delete from public.receiving_item_locations where location_id=v_id;
  update public.inventory_items set default_location='' where category<>'FG' and default_location=(select code from public.receiving_locations where id=v_id);
  if v_used then update public.receiving_locations set active=false,archived=true where id=v_id;
  else delete from public.receiving_locations where id=v_id; end if;
 elsif p_kind='material' then
  if exists(select 1 from public.receiving_material_types where code=p_key and builtin) then raise exception 'catalog_builtin'; end if;
  v_used:=exists(select 1 from public.receiving_item_types where material_type=p_key) or exists(select 1 from public.receiving_locations where material_type=p_key);
  if v_used then update public.receiving_material_types set active=false,archived=true where code=p_key;
  else delete from public.receiving_material_types where code=p_key; end if;
 else raise exception 'receiving_invalid'; end if;
 return case when v_used then 'archived' else 'deleted' end;
end $$;
create or replace function public.catalog_remove(p_kind text,p_key text) returns text language sql security invoker set search_path='' as $$select rls_internal.catalog_remove($1,$2);$$;
revoke all on function rls_internal.catalog_remove(text,text),public.catalog_remove(text,text) from public,anon;
grant execute on function rls_internal.catalog_remove(text,text),public.catalog_remove(text,text) to authenticated;

create or replace function rls_internal.inventory_catalog_recipe(p_action text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=nullif(p_data->>'id','')::uuid; v_part text; v_item uuid; v_version integer; v_line jsonb; v_qty numeric; v_waste numeric; v_active boolean;
begin
 if not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden'; end if;
 if p_action='delete' then
  perform 1 from public.inventory_boms where id=v_id for update;
  if not found then raise exception 'catalog_not_found'; end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) then
   update public.inventory_boms set active=false,archived=true where id=v_id;
  else delete from public.inventory_boms where id=v_id; end if;
  return v_id;
 end if;
 if p_action<>'save' then raise exception 'receiving_invalid'; end if;
 v_part:=upper(btrim(p_data->>'product_part_number'));
 if v_part is null or v_part='' or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'catalog_recipe_required'; end if;
 select id into v_item from public.inventory_items where category='FG' and part_number=v_part;
 if v_id is not null then
  perform 1 from public.inventory_boms where id=v_id and not archived for update;
  if not found then raise exception 'catalog_not_found'; end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) then raise exception 'catalog_recipe_used'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_part,0));
 v_version:=nullif(p_data->>'version','')::integer;
 if v_version is null then select coalesce(max(version),0)+1 into v_version from public.inventory_boms where product_part_number=v_part; end if;
 if v_version<1 then raise exception 'receiving_invalid'; end if;
 v_active:=coalesce((p_data->>'active')::boolean,true);
 if v_active then update public.inventory_boms set active=false where product_part_number=v_part and active and id is distinct from v_id; end if;
 if v_id is null then
  insert into public.inventory_boms(finished_item_id,product_part_number,version,active,notes,created_by)
  values(v_item,v_part,v_version,v_active,nullif(p_data->>'notes',''),auth.uid()) returning id into v_id;
 else
  update public.inventory_boms set finished_item_id=v_item,product_part_number=v_part,version=v_version,active=v_active,notes=nullif(p_data->>'notes','') where id=v_id;
  delete from public.inventory_bom_lines where bom_id=v_id;
 end if;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  v_qty:=(v_line->>'quantity_per_unit')::numeric;
  v_waste:=coalesce((v_line->>'waste_rate')::numeric,0);
  if v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_waste<0 or v_waste>=1 or v_waste::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity'; end if;
  if not exists(select 1 from public.inventory_items where id=(v_line->>'ingredient_id')::uuid and active and category in ('RAW','PACKAGING')) then raise exception 'catalog_recipe_ingredient'; end if;
  insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit,waste_rate) values(v_id,(v_line->>'ingredient_id')::uuid,v_qty,v_waste);
 end loop;
 return v_id;
end $$;
create or replace function public.inventory_catalog_recipe(p_action text,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$select rls_internal.inventory_catalog_recipe($1,$2);$$;
revoke all on function rls_internal.inventory_catalog_recipe(text,jsonb),public.inventory_catalog_recipe(text,jsonb) from public,anon;
grant execute on function rls_internal.inventory_catalog_recipe(text,jsonb),public.inventory_catalog_recipe(text,jsonb) to authenticated;
commit;