CREATE OR REPLACE FUNCTION public.shipping_records_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
 v_search text := lower(nullif(btrim(p_filters->>'search'),''));
 v_activity_ids text[] := '{}';
 v_product_ids text[] := '{}';
 v_operator_ids text[] := '{}';
begin
 if auth.uid() is null or not public.inventory_access('shipping') or not rls_internal.role_activity_access('shipping','records') then raise exception 'ra_denied';end if;
 if jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'ra_invalid';end if;
 if v_search is not null then
 select coalesce(array_agg(k.id::text),'{}') into v_activity_ids from public.actividades k where strpos(lower(k.nombre),v_search)>0;
 select coalesce(array_agg(k.id::text),'{}') into v_product_ids from public.productos k where strpos(lower(concat_ws(' ',k.nombre,k.part_number)),v_search)>0;
 select coalesce(array_agg(o.id::text),'{}') into v_operator_ids from public.operadores o where strpos(lower(o.nombre),v_search)>0;
 end if;
 with matching as materialized(
 select a.id,a.hora_inicio from public.actividades_realizadas a
 left join public.shipping_activity_labels c on c.actividad_id=a.id
 where a.hora_fin is not null
 and (nullif(p_filters->>'from','') is null or a.hora_inicio>=(p_filters->>'from')::timestamptz)
 and (nullif(p_filters->>'to','') is null or a.hora_inicio<(p_filters->>'to')::timestamptz)
 and (coalesce(jsonb_array_length(p_filters->'activities'),0)=0 or a.actividad in(select jsonb_array_elements_text(p_filters->'activities')))
 and (coalesce(jsonb_array_length(p_filters->'operators'),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'operators') p where a.operadores ? p))
 and (coalesce(jsonb_array_length(p_filters->'products'),0)=0 or exists(select 1 from jsonb_array_elements(coalesce(a.productos,'[]')) p where p->>'producto' in(select jsonb_array_elements_text(p_filters->'products'))))
 and (nullif(btrim(p_filters->>'search'),'') is null or
 strpos(lower(concat_ws(' ',a.idx,c.trailer,c.puerta,c.trailer_fin,c.puerta_fin,c.etiqueta_inicio,c.etiqueta_fin,a.trailer,a.puerta,a.trailer_fin,a.puerta_fin,a.etiqueta_inicio_manual,a.etiqueta_fin_manual)),lower(btrim(p_filters->>'search')))>0
 or a.actividad = any(v_activity_ids)
 or exists(select 1 from jsonb_array_elements(coalesce(a.productos,'[]')) p where p->>'producto'=any(v_product_ids))
 or a.operadores ?| v_operator_ids)
 ), bounds as(
 select count(*) total,greatest(1,least(coalesce(p_page_size,25),1000)) size,
 greatest(1,least(coalesce(p_page,1),greatest(1,ceil(count(*)::numeric/greatest(1,least(coalesce(p_page_size,25),1000)))::integer))) page from matching
 ), selected as(
 select id from matching order by hora_inicio desc nulls last,id desc limit(select size from bounds) offset(select(page-1)*size from bounds)
 ), rows as(select a.* from public.actividades_realizadas a join selected s using(id))
 select jsonb_build_object('total',b.total,'page',b.page,
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.hora_inicio desc nulls last,r.id desc) from rows r),'[]'),
 'captures',coalesce((select jsonb_object_agg(c.actividad_id,to_jsonb(c)) from public.shipping_activity_labels c join selected s on s.id=c.actividad_id),'{}'))
 into result from bounds b;
 return result;
end $function$
;
