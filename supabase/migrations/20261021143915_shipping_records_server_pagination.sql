
create index if not exists shipping_records_page_order on public.actividades_realizadas(hora_inicio desc,id desc) where hora_fin is not null;
create or replace function public.shipping_records_page(p_page integer default 1,p_page_size integer default 25,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.inventory_access('shipping') or not rls_internal.role_activity_access('shipping','records') then raise exception 'ra_denied';end if;
 if jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'ra_invalid';end if;
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
 or exists(select 1 from public.actividades k where k.id::text=a.actividad and strpos(lower(k.nombre),lower(btrim(p_filters->>'search')))>0)
 or exists(select 1 from jsonb_array_elements(coalesce(a.productos,'[]')) p join public.productos k on k.id::text=p->>'producto' where strpos(lower(concat_ws(' ',k.nombre,k.part_number)),lower(btrim(p_filters->>'search')))>0)
 or exists(select 1 from public.operadores o where a.operadores ? o.id::text and strpos(lower(o.nombre),lower(btrim(p_filters->>'search')))>0))
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
end $$;
revoke all on function public.shipping_records_page(integer,integer,jsonb) from public,anon;
grant execute on function public.shipping_records_page(integer,integer,jsonb) to authenticated;
