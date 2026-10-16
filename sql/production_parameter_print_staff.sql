CREATE OR REPLACE FUNCTION rls_internal.production_parameter_snapshot(p_from date, p_to date, p_station text DEFAULT ''::text, p_search text DEFAULT ''::text, p_outside boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare manager boolean; reports jsonb; total integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or length(coalesce(p_search,''))>100 then raise exception 'pr_time_invalid';end if;
 manager:=public.inventory_access('production',true);
 with base as (
  select c.*,req.version as capture_version,req.updated_at,req.updated_by,(select nombre from public.operadores where uid=req.updated_by limit 1) as updated_by_name,case when jsonb_array_length(c.products)>0 then c.products else
   jsonb_agg(jsonb_build_object('item_id',c.item_id,'part_number',c.part_number,'part_name',c.part_name)) over(partition by c.capture_group_id order by c.part_number,c.id rows between unbounded preceding and unbounded following) end as capture_products
  from public.production_parameter_checks c join public.production_parameter_requests req on req.id=c.capture_group_id where req.deleted_at is null and (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station)
 ), grouped as (
  select distinct on(capture_group_id) * from base order by capture_group_id,id
 ), eligible as (
  select (to_jsonb(g)-'capture_products')||jsonb_build_object('products',g.capture_products,'author_role',coalesce((select m.role from public.global_department_memberships m where m.user_id=g.leader_id and m.department='production' limit 1),''),
    'part_number',(select string_agg(x->>'part_number',' / ') from jsonb_array_elements(g.capture_products) x),
    'part_name',(select string_agg(x->>'part_name',' / ') from jsonb_array_elements(g.capture_products) x)) as report,g.recorded_at,g.id
  from grouped g where (coalesce(p_search,'')='' or concat_ws(' ',g.capture_products::text,g.leader_name,g.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or g.out_of_range)
 ) select (select count(*) from eligible),coalesce((select jsonb_agg(x.report order by x.recorded_at desc,x.id) from (select * from eligible order by recorded_at desc,id limit 500)x),'[]') into total,reports;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t where t.deleted_at is null),'reports',reports,'total',total,'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo and m.role in ('supervisor','lider') and nullif(trim(o.nombre),'') is not null));
end $function$

