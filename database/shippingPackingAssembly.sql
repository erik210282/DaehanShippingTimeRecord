create or replace function rls_internal.shipping_packing_sources(p_product uuid, p_historical boolean default false)
returns jsonb language sql stable set search_path='' set jit=off as $$
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


-- One choice represents the complete packaging recipe, independent of report dates.
alter table public.inventory_bom_packaging add column if not exists shipping_dimensions text;

create or replace function rls_internal.shipping_packing_options(p_product uuid,p_historical boolean default false)
returns jsonb language sql stable set search_path='' set jit=off as $$
with product as materialized (select * from public.productos where id=p_product),
sources as materialized (select s from jsonb_array_elements(rls_internal.shipping_packing_sources(p_product,p_historical)) s),
details as materialized (
 select s,profile.boxes_per_pallet,profile.shipping_dimensions,
 coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'part_number',m.part_number,
 'packing_type',m.packing_type,'dimensions',m.packing_measures,'quantity',l.quantity,
 'basis',l.basis,'waste_rate',l.waste_rate,'weight_lb',case when m.packing_weight_unit='kg' then m.packing_weight*2.2046226218487757 else m.packing_weight end)
 order by m.id) from public.inventory_bom_packaging_lines l join public.inventory_items m on m.id=l.ingredient_id
 where l.bom_id=(s->>'bom_id')::uuid and l.packaging_type=s->>'variant'),'[]'::jsonb) components
 from sources left join public.inventory_bom_packaging profile on profile.bom_id=(s->>'bom_id')::uuid and profile.packaging_type=s->>'variant'
 where not coalesce((s->>'legacy')::boolean,false)
), packages as materialized (
 select d.*, (select min(m->>'packing_type') from jsonb_array_elements(components) m where m->>'packing_type' in ('returnable','expendable')) kind,
 jsonb_build_object('capacity',s->'pieces_per_box','boxes_per_pallet',boxes_per_pallet,'shipping_dimensions',shipping_dimensions,
 'components',(select jsonb_agg(m-'weight_lb'-'dimensions'-'part_number' order by m->>'id') from jsonb_array_elements(components) m)) signature
 from details d
), resolved as materialized (
 select x.*,coalesce(nullif(btrim(shipping_dimensions),''),
 case when (select count(*) from jsonb_array_elements(components) m where m->>'packing_type' is not null)=1
 then (select m->>'dimensions' from jsonb_array_elements(components) m where m->>'packing_type' is not null limit 1)
 else case when
  (case kind when 'returnable' then p.cantidad_por_caja_retornable else p.cantidad_por_caja_expendable end)=(s->>'pieces_per_box')::numeric
  or (select count(distinct k.s->>'variant') from packages k where k.kind=x.kind)=1
 then case kind when 'returnable' then p.tipo_empaque_retornable else p.tipo_empaque_expendable end end end) dimensions,
 case when (select bool_and(m->>'weight_lb' is not null) from jsonb_array_elements(components) m)
 then (select sum((m->>'quantity')::numeric*(m->>'weight_lb')::numeric*
 case m->>'basis' when 'piece' then (s->>'pieces_per_box')::numeric when 'pallet' then 1.0/nullif(boxes_per_pallet,0) else 1 end) from jsonb_array_elements(components) m)
 else case kind when 'returnable' then p.peso_caja_retornable else p.peso_caja_expendable end end box_weight
 from packages x cross join product p
), grouped as materialized (
 select signature,min(s->>'option_id') representative,
 jsonb_agg(s->>'option_id' order by s->>'option_id') source_option_ids,
 coalesce(jsonb_agg(jsonb_build_object('id',s->>'report_id','date',s->>'production_date') order by s->>'report_id') filter(where s->>'report_id' is not null),'[]'::jsonb) production_reports
 from resolved group by signature
), configured as (
 select 'config:'||md5(g.signature::text) option_id,
 r.s||jsonb_build_object('option_id','config:'||md5(g.signature::text),'report_id',null,'production_date',null,
 'source_option_ids',g.source_option_ids,'production_reports',g.production_reports,'assembly_version',2,
 'materials',jsonb_build_array(jsonb_build_object('id','config:'||md5(g.signature::text),
 'part_number',(select string_agg(m->>'part_number',' + ' order by m->>'part_number') from jsonb_array_elements(r.components) m),
 'packing_type',r.kind,'dimensions',r.dimensions,'box_weight',r.box_weight,'components',r.components,
 'component_ids',(select jsonb_agg(m->>'id') from jsonb_array_elements(r.components) m),
 'dimension_source',case when nullif(btrim(r.shipping_dimensions),'') is not null then 'recipe' when (select count(*) from jsonb_array_elements(r.components) m where m->>'packing_type' is not null)=1 then 'material' else 'existing_package' end,
 'weight_complete',(select bool_and(m->>'weight_lb' is not null) from jsonb_array_elements(r.components) m),
 'boxes_per_pallet',r.boxes_per_pallet))) value
 from grouped g join resolved r on r.signature=g.signature and r.s->>'option_id'=g.representative
)
select coalesce(jsonb_agg(value order by option_id),'[]'::jsonb) from (
 select * from configured union all select s->>'option_id',s from sources where coalesce((s->>'legacy')::boolean,false)
) choices;
$$;

revoke all on function rls_internal.shipping_packing_sources(uuid,boolean) from public,anon,authenticated;

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
end $$;

