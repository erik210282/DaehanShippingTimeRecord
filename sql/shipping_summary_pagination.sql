-- Page complete IDX groups under the caller's existing table/RLS permissions.
create collation if not exists public.shipping_idx_natural (provider = icu, locale = 'und-u-kn-true');
create index if not exists shipping_summary_idx on public.actividades_realizadas (idx, "createdAt", id) where estado = 'finalizada' and idx is not null and idx <> '';
create index if not exists shipping_summary_started on public.actividades_realizadas (hora_inicio) where estado = 'finalizada';
create or replace function public.shipping_summary_page(
 p_page integer default 1, p_page_size integer default 25, p_idx text default '',
 p_from timestamptz default null, p_to timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with keys as materialized (
  select distinct a.idx from public.actividades_realizadas a
  where a.estado = 'finalizada' and a.idx is not null and a.idx <> ''
   and (coalesce(p_idx,'') = '' or strpos(lower(a.idx),lower(p_idx)) > 0)
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 ), bounds as (
  select count(*) as total, greatest(1,least(coalesce(p_page,1),
   greatest(1,ceil(count(*)::numeric / greatest(1,least(coalesce(p_page_size,25),100)))::integer))) as page,
   greatest(1,least(coalesce(p_page_size,25),100)) as size from keys
 ), selected as (
  select idx from keys order by idx collate public.shipping_idx_natural desc, idx desc
  limit (select size from bounds) offset (select (page-1)*size from bounds)
 ), rows as (
  select a.id,a.estado,a.hora_inicio,a.productos,a.operadores,a.notas,a.duracion,a.idx,
   a."createdAt",a.actividad,a.pausa_total,a.comentario_actividad,
   a.trailer,a.puerta,a.trailer_fin,a.puerta_fin,a.etiqueta_inicio_manual,a.etiqueta_fin_manual
  from public.actividades_realizadas a join selected s using(idx)
  where a.estado = 'finalizada'
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 )
 select jsonb_build_object('total',b.total,'page',b.page,
  'activities',coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt",r.id) from rows r),'[]'::jsonb),
  'captures',coalesce((select jsonb_object_agg(c.actividad_id,jsonb_build_object(
   'etiqueta_inicio',c.etiqueta_inicio,'etiqueta_fin',c.etiqueta_fin,
   'trailer',c.trailer,'puerta',c.puerta,'trailer_fin',c.trailer_fin,'puerta_fin',c.puerta_fin))
   from public.shipping_activity_labels c join rows r on r.id=c.actividad_id),'{}'::jsonb))
 from bounds b;
$$;
revoke all on function public.shipping_summary_page(integer,integer,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.shipping_summary_page(integer,integer,text,timestamptz,timestamptz) to authenticated;
