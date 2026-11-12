-- Match the Shipping BOL activity permission and retain Inventory supervisor access.
CREATE OR REPLACE FUNCTION rls_internal.shipping_packing_context(p_idx text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; confirmed boolean;
begin
 if auth.uid() is null or not (
   rls_internal.role_activity_access('shipping', 'bol')
   or public.inventory_access('inventory', true)
 ) then
  raise exception 'ra_denied';
 end if;
 select exists(select 1 from public.inventory_dispatches where idx=p_idx) into confirmed;
 select jsonb_build_object('confirmed',confirmed,'lines',coalesce(jsonb_agg(
 jsonb_build_object('id',l.id,'producto',l.producto,'cantidad_cajas',l.cantidad_cajas,
 'product',to_jsonb(p),'allocations',l.packing_allocations,'saved_at',l.packing_saved_at,
 'dispatch_capacity',(select d.pieces_per_box from public.inventory_dispatch_lines d where d.shipping_line_id=l.id and d.idx=l.idx),
 'historical',confirmed and l.packing_allocations is null,
 'options',rls_internal.shipping_packing_options(l.producto,confirmed and l.packing_allocations is null)) order by l.idx_line,l.id),'[]'::jsonb))
 into result from public.shipping_lines l join public.productos p on p.id=l.producto where l.idx=p_idx;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.shipping_save_packing(p_idx text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l record; entry jsonb; allocation jsonb; opt jsonb; mat jsonb; snapshots jsonb;
 options jsonb; total_boxes integer; boxes integer; v_count integer; product_weight numeric;
begin
 if auth.uid() is null or not (
   rls_internal.role_activity_access('shipping', 'bol')
   or public.inventory_access('inventory', true)
 ) then
  raise exception 'ra_denied';
 end if;
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
  if l.packing_allocations is not null and not exists(select 1 from jsonb_array_elements(l.packing_allocations) old where not coalesce((old->>'legacy')::boolean,false) and coalesce((old->>'assembly_version')::int,1)<2) and (select jsonb_agg(a-'expected_capacity'-'expected_dimensions') from jsonb_array_elements(entry->'allocations') a)=(select jsonb_agg(jsonb_build_object(
   'boxes',(a->>'boxes')::integer,'option_id',a->>'option_id','material_id',a->>'material_id')) from jsonb_array_elements(l.packing_allocations) a)
  and (select sum((a->>'boxes')::integer) from jsonb_array_elements(l.packing_allocations) a)=l.cantidad_cajas then continue; end if;
  options:=rls_internal.shipping_packing_options(l.producto,false); snapshots:='[]'; total_boxes:=0;
  select coalesce(peso_por_pieza,0) into product_weight from public.productos where id=l.producto;
  for allocation in select * from jsonb_array_elements(entry->'allocations') loop
   if coalesce(allocation->>'boxes','') !~ '^[0-9]+$' then raise exception 'sp_boxes'; end if;
   boxes:=(allocation->>'boxes')::integer;
   if boxes<=0 then raise exception 'sp_boxes'; end if;
   select v into opt from jsonb_array_elements(options) v where v->>'option_id'=allocation->>'option_id' or v->'source_option_ids' @> jsonb_build_array(allocation->>'option_id');
   if opt is null then raise exception 'sp_unavailable'; end if;
   select v into mat from jsonb_array_elements(opt->'materials') v where v->>'id'=allocation->>'material_id' or v->'component_ids' @> jsonb_build_array(allocation->>'material_id');
   if mat is null then raise exception 'sp_material'; end if;
   if nullif(btrim(mat->>'dimensions'),'') is null then raise exception 'sp_dimensions_required'; end if;
   if (allocation ? 'expected_capacity' and (allocation->>'expected_capacity')::numeric is distinct from (opt->>'pieces_per_box')::numeric)
    or (allocation ? 'expected_dimensions' and allocation->>'expected_dimensions' is distinct from mat->>'dimensions') then raise exception 'sp_stale'; end if;
   snapshots:=snapshots||jsonb_build_array(jsonb_build_object('boxes',boxes,
    'option_id',opt->>'option_id','material_id',mat->>'id','bom_id',opt->>'bom_id',
    'variant',opt->>'variant','report_id',opt->>'report_id','production_date',opt->>'production_date',
    'pieces_per_box',(opt->>'pieces_per_box')::numeric,'packing_type',mat->>'packing_type',
    'package_label',mat->>'package_label',
    'material_part_number',mat->>'part_number','dimensions',mat->>'dimensions',
    'box_weight',coalesce((mat->>'box_weight')::numeric,0),'piece_weight',product_weight,
    'assembly_version',2,'components',mat->'components','production_reports',opt->'production_reports','source_option_ids',opt->'source_option_ids','weight_complete',mat->'weight_complete','boxes_per_pallet',mat->'boxes_per_pallet','legacy',coalesce((opt->>'legacy')::boolean,false)));
   total_boxes:=total_boxes+boxes;
  end loop;
  if total_boxes<>l.cantidad_cajas then raise exception 'sp_boxes'; end if;
  update public.shipping_lines set packing_allocations=snapshots,packing_saved_at=now() where id=l.id;
 end loop;
 return rls_internal.shipping_packing_context(p_idx);
end $function$;
