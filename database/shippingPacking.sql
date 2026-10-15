-- Additive packaging snapshots. Existing dispatches and legacy fields are retained.
alter table public.shipping_lines add column if not exists packing_allocations jsonb;
alter table public.shipping_lines add column if not exists packing_saved_at timestamptz;
alter table public.inventory_dispatch_lines add column if not exists packing_allocations jsonb;

-- Mixed packages can have a fractional average capacity. Store their exact
-- sum in the generated pieces column, keeping the legacy expression for old rows.
create or replace function rls_internal.shipping_packing_pieces(p_allocations jsonb)
returns numeric language sql immutable strict set search_path='' as $$
 select sum((a->>'boxes')::numeric*(a->>'pieces_per_box')::numeric) from jsonb_array_elements(p_allocations) a
$$;
alter table public.inventory_dispatch_lines alter column pieces set expression as
 (case when packing_allocations is null then boxes*pieces_per_box
 else rls_internal.shipping_packing_pieces(packing_allocations) end);

create or replace function rls_internal.shipping_packing_options(p_product uuid, p_historical boolean default false)
returns jsonb language sql stable set search_path='' as $$
with product as (
 select p.*, i.id item_id, i.active inventory_active from public.productos p
 left join public.inventory_items i on i.producto_id=p.id and i.category='FG'
 where p.id=p_product
), profiles as (
 select 'bom:'||b.id||':'||v.packaging_type option_id,b.id bom_id,v.packaging_type,
 v.box_name,v.pieces_per_box,null::uuid report_id,null::date production_date
 from product p join public.inventory_boms b on b.finished_item_id=p.item_id and b.active and not b.archived
 join public.inventory_bom_packaging v on v.bom_id=b.id
 where not p_historical and p.activo and p.inventory_active
 union all
 select 'report:'||r.id,r.bom_id,r.packaging_type,r.packing_box_name,r.pieces_per_box,r.id,r.production_date
 from product p join public.production_station_reports r on r.item_id=p.item_id
 where not p_historical and p.activo and p.inventory_active and r.status='posted'
 and r.packed_quantity>0 and r.pieces_per_box>0
), configured as (
 select v.option_id, jsonb_build_object('option_id',v.option_id,'bom_id',v.bom_id,
 'variant',v.packaging_type,'box_name',v.box_name,'pieces_per_box',v.pieces_per_box,
 'report_id',v.report_id,'production_date',v.production_date,'legacy',false,
 'materials',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'part_number',m.part_number,
 'packing_type',m.packing_type,'dimensions',m.packing_measures,
 'box_weight',case m.packing_type when 'returnable' then p.peso_caja_retornable else p.peso_caja_expendable end)
 order by m.part_number)
 from public.inventory_items m where m.id in (
 select l.ingredient_id from public.inventory_bom_packaging_lines l
 where l.bom_id=v.bom_id and l.packaging_type=v.packaging_type)
 and m.category='PACKAGING' and m.packing_type in ('returnable','expendable')
 and nullif(btrim(m.packing_measures),'') is not null
 and (m.active or v.report_id is not null)), '[]'::jsonb)) value
 from profiles v cross join product p where v.pieces_per_box>0
), legacy as (
 select 'legacy:'||k.kind option_id,jsonb_build_object('option_id','legacy:'||k.kind,
 'variant',k.kind,'box_name',k.kind,'pieces_per_box',k.capacity,'legacy',true,
 'materials',jsonb_build_array(jsonb_build_object('id',k.kind,'part_number',k.kind,
 'packing_type',k.kind,'package_label',case when k.kind='returnable' then p.bin_type else 'Box' end,
 'dimensions',k.dimensions,'box_weight',k.box_weight))) value
 from product p cross join lateral (values
 ('returnable',p.cantidad_por_caja_retornable,p.tipo_empaque_retornable,p.peso_caja_retornable),
 ('expendable',p.cantidad_por_caja_expendable,p.tipo_empaque_expendable,p.peso_caja_expendable)
 ) k(kind,capacity,dimensions,box_weight)
 where (p_historical or not coalesce(p.activo,false) or not coalesce(p.inventory_active,false)) and k.capacity>0
)
select coalesce(jsonb_agg(value order by option_id),'[]'::jsonb) from (
 select * from configured where jsonb_array_length(value->'materials')>0 union all select * from legacy
) choices;
$$;

create or replace function rls_internal.shipping_packing_context(p_idx text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; confirmed boolean;
begin
 if auth.uid() is null or not (public.inventory_access('shipping',true) or public.inventory_access('inventory',true)) then raise exception 'ra_denied'; end if;
 select exists(select 1 from public.inventory_dispatches where idx=p_idx) into confirmed;
 select jsonb_build_object('confirmed',confirmed,'lines',coalesce(jsonb_agg(
 jsonb_build_object('id',l.id,'producto',l.producto,'cantidad_cajas',l.cantidad_cajas,
 'product',to_jsonb(p),'allocations',l.packing_allocations,'saved_at',l.packing_saved_at,
 'dispatch_capacity',(select d.pieces_per_box from public.inventory_dispatch_lines d where d.shipping_line_id=l.id and d.idx=l.idx),
 'historical',confirmed and l.packing_allocations is null,
 'options',rls_internal.shipping_packing_options(l.producto,confirmed and l.packing_allocations is null)) order by l.idx_line,l.id),'[]'::jsonb))
 into result from public.shipping_lines l join public.productos p on p.id=l.producto where l.idx=p_idx;
 return result;
end $$;

create or replace function rls_internal.shipping_save_packing(p_idx text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l record; entry jsonb; allocation jsonb; opt jsonb; mat jsonb; snapshots jsonb;
 options jsonb; total_boxes integer; boxes integer; v_count integer; product_weight numeric;
begin
 if auth.uid() is null or not (public.inventory_access('shipping',true) or public.inventory_access('inventory',true)) then raise exception 'ra_denied'; end if;
 -- Serialize edits and confirmation for an IDX, including edits from another device.
 perform pg_advisory_xact_lock(hashtextextended('shipping-packing:'||p_idx,0));
 if exists(select 1 from public.inventory_dispatches where idx=p_idx) then raise exception 'sp_confirmed'; end if;
 perform 1 from public.shipping_lines where idx=p_idx order by id for update;
 select count(*) into v_count from public.shipping_lines where idx=p_idx;
 if jsonb_typeof(p_lines) is distinct from 'array' or v_count=0 or jsonb_array_length(p_lines)<>v_count then raise exception 'sp_invalid'; end if;
 if (select count(distinct v->>'line_id') from jsonb_array_elements(p_lines) v)<>v_count then raise exception 'sp_invalid'; end if;
 for l in select * from public.shipping_lines where idx=p_idx loop
  select v into entry from jsonb_array_elements(p_lines) v where v->>'line_id'=l.id::text;
  if (entry->>'saved_at')::timestamptz is distinct from l.packing_saved_at then raise exception 'sp_stale'; end if;
  if entry is null or jsonb_typeof(entry->'allocations') is distinct from 'array' or jsonb_array_length(entry->'allocations')=0 then raise exception 'sp_required'; end if;
  if l.packing_allocations is not null and (select jsonb_agg(a-'expected_capacity'-'expected_dimensions') from jsonb_array_elements(entry->'allocations') a)=(select jsonb_agg(jsonb_build_object(
   'boxes',(a->>'boxes')::integer,'option_id',a->>'option_id','material_id',a->>'material_id')) from jsonb_array_elements(l.packing_allocations) a)
  and (select sum((a->>'boxes')::integer) from jsonb_array_elements(l.packing_allocations) a)=l.cantidad_cajas then continue; end if;
  options:=rls_internal.shipping_packing_options(l.producto,false); snapshots:='[]'; total_boxes:=0;
  select coalesce(peso_por_pieza,0) into product_weight from public.productos where id=l.producto;
  for allocation in select * from jsonb_array_elements(entry->'allocations') loop
   if coalesce(allocation->>'boxes','') !~ '^[0-9]+$' then raise exception 'sp_boxes'; end if;
   boxes:=(allocation->>'boxes')::integer;
   if boxes<=0 then raise exception 'sp_boxes'; end if;
   select v into opt from jsonb_array_elements(options) v where v->>'option_id'=allocation->>'option_id';
   if opt is null then raise exception 'sp_unavailable'; end if;
   select v into mat from jsonb_array_elements(opt->'materials') v where v->>'id'=allocation->>'material_id';
   if mat is null then raise exception 'sp_material'; end if;
   if (allocation ? 'expected_capacity' and (allocation->>'expected_capacity')::numeric is distinct from (opt->>'pieces_per_box')::numeric)
    or (allocation ? 'expected_dimensions' and allocation->>'expected_dimensions' is distinct from mat->>'dimensions') then raise exception 'sp_stale'; end if;
   snapshots:=snapshots||jsonb_build_array(jsonb_build_object('boxes',boxes,
    'option_id',opt->>'option_id','material_id',mat->>'id','bom_id',opt->>'bom_id',
    'variant',opt->>'variant','report_id',opt->>'report_id','production_date',opt->>'production_date',
    'pieces_per_box',(opt->>'pieces_per_box')::numeric,'packing_type',mat->>'packing_type',
    'package_label',mat->>'package_label',
    'material_part_number',mat->>'part_number','dimensions',mat->>'dimensions',
    'box_weight',coalesce((mat->>'box_weight')::numeric,0),'piece_weight',product_weight,
    'legacy',coalesce((opt->>'legacy')::boolean,false)));
   total_boxes:=total_boxes+boxes;
  end loop;
  if total_boxes<>l.cantidad_cajas then raise exception 'sp_boxes'; end if;
  update public.shipping_lines set packing_allocations=snapshots,packing_saved_at=now() where id=l.id;
 end loop;
 return rls_internal.shipping_packing_context(p_idx);
end $$;

create or replace function public.shipping_packing_context(p_idx text)
returns jsonb language sql set search_path='' as $$select rls_internal.shipping_packing_context($1)$$;
create or replace function public.shipping_save_packing(p_idx text,p_lines jsonb)
returns jsonb language sql set search_path='' as $$select rls_internal.shipping_save_packing($1,$2)$$;

create or replace function rls_internal.shipping_confirm_packing(p_idx text,p_date date,p_lines jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare l record; payload jsonb;
begin
 if auth.uid() is null or not public.inventory_access('shipping',true) then raise exception 'ra_denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-packing:'||p_idx,0));
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'sp_invalid'; end if;
 for l in select * from public.shipping_lines where idx=p_idx order by id for update loop
  if l.packing_allocations is null then raise exception 'sp_required'; end if;
  if not exists(select 1 from jsonb_array_elements(p_lines) a where a->>'line_id'=l.id::text
     and (a->>'saved_at')::timestamptz=l.packing_saved_at) then raise exception 'sp_stale'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('line_id',a->>'line_id','pieces_per_box',1)) into payload from jsonb_array_elements(p_lines) a;
 return rls_internal.inventory_confirm_dispatch(p_idx,p_date,payload,'Packaging confirmed in Shipping');
end $$;
create or replace function public.shipping_confirm_packing(p_idx text,p_date date,p_lines jsonb)
returns text language sql set search_path='' as $$select rls_internal.shipping_confirm_packing($1,$2,$3)$$;

-- Preserve the existing permission checks and legacy clients. A saved selection
-- takes precedence over any pieces-per-box submitted by an older client.
create or replace function rls_internal.inventory_confirm_dispatch(p_idx text,p_date date,p_lines jsonb,p_note text default '')
returns text language plpgsql security definer set search_path='' as $$
declare v_line record; v_count integer; v_boxes numeric; v_pieces numeric; v_per_box numeric;
begin
 if auth.uid() is null or not rls_internal.role_activity_access('inventory','dispatch') then raise exception 'ra_denied'; end if;
 if not public.inventory_access('shipping',true) or nullif(btrim(p_idx),'') is null
 or p_date is null or p_date>(now() at time zone 'America/Los_Angeles')::date
 or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'sp_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-packing:'||p_idx,0));
 perform 1 from public.shipping_lines where idx=p_idx order by id for update;
 if not exists(select 1 from public.actividades_realizadas r join public.actividades a on a.id::text=r.actividad
 where r.idx=p_idx and lower(a.nombre)='load' and r.estado='finalizada') then raise exception 'El IDX no tiene un LOAD finalizado'; end if;
 select count(*) into v_count from public.shipping_lines where idx=p_idx;
 if v_count=0 or v_count<>jsonb_array_length(p_lines)
 or (select count(distinct v->>'line_id') from jsonb_array_elements(p_lines) v)<>v_count then raise exception 'sp_invalid'; end if;
 insert into public.inventory_dispatches(idx,ship_date,confirmed_by,note) values(p_idx,p_date,auth.uid(),coalesce(p_note,''));
 for v_line in select l.*,i.id item_id,v->>'pieces_per_box' submitted_capacity
 from jsonb_array_elements(p_lines) v join public.shipping_lines l on l.id::text=v->>'line_id' and l.idx=p_idx
 join public.inventory_items i on i.producto_id=l.producto and i.category='FG' loop
  if v_line.packing_allocations is not null then
   select sum((a->>'boxes')::numeric),sum((a->>'boxes')::numeric*(a->>'pieces_per_box')::numeric)
   into v_boxes,v_pieces from jsonb_array_elements(v_line.packing_allocations) a;
   if v_boxes<>v_line.cantidad_cajas or v_boxes<=0 or v_pieces<=0 then raise exception 'sp_boxes'; end if;
   v_per_box:=v_pieces/v_boxes;
  else
   if coalesce(v_line.submitted_capacity,'') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'sp_required'; end if;
   v_per_box:=v_line.submitted_capacity::numeric;
   if v_per_box<=0 then raise exception 'sp_required'; end if;
   v_pieces:=v_line.cantidad_cajas*v_per_box;
  end if;
  insert into public.inventory_dispatch_lines(idx,shipping_line_id,item_id,boxes,pieces_per_box,packing_allocations)
  values(p_idx,v_line.id,v_line.item_id,v_line.cantidad_cajas,v_per_box,v_line.packing_allocations);
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
  values(v_line.item_id,'FG',-v_pieces,'SHIPMENT','dispatch:'||v_line.id,coalesce(p_note,''),p_date,auth.uid());
 end loop;
 if (select count(*) from public.inventory_dispatch_lines where idx=p_idx)<>v_count then raise exception 'sp_invalid'; end if;
 return p_idx;
end $$;

revoke all on function rls_internal.shipping_packing_options(uuid,boolean) from public,anon,authenticated;
revoke all on function rls_internal.shipping_packing_context(text) from public,anon;
revoke all on function rls_internal.shipping_save_packing(text,jsonb) from public,anon;
grant execute on function rls_internal.shipping_packing_context(text),rls_internal.shipping_save_packing(text,jsonb) to authenticated;
revoke all on function public.shipping_packing_context(text),public.shipping_save_packing(text,jsonb) from public,anon;
grant execute on function public.shipping_packing_context(text),public.shipping_save_packing(text,jsonb) to authenticated;
revoke all on function rls_internal.shipping_confirm_packing(text,date,jsonb),public.shipping_confirm_packing(text,date,jsonb) from public,anon;
grant execute on function rls_internal.shipping_confirm_packing(text,date,jsonb),public.shipping_confirm_packing(text,date,jsonb) to authenticated;
