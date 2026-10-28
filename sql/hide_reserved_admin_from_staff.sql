-- Exclude the reserved maintenance account from selectable rosters and print approvers.
-- Authentication, authorization, author identities and other staff remain unchanged.
CREATE OR REPLACE FUNCTION rls_internal.department_operators(p_department text, p_include_inactive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.inventory_access(p_department)
     or p_department not in ('shipping','production','receiving','quality','inventory') then
    raise exception 'Department access required' using errcode = '42501';
  end if;
  if p_include_inactive and not global_private.can_manage_department(p_department) then
    raise exception 'Department supervisor access required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'uid',o.uid,'nombre',o.nombre,'email',o.email,
    'role',m.role,'activo',o.activo,'inactive_since',o.inactive_since,'assigned',true
  ) order by o.activo desc,o.nombre,o.id)
  from public.operadores o join public.global_department_memberships m on m.user_id=o.uid
  where m.department=p_department and m.active is true and o.uid <> 'b291183c-efd7-4686-9fb5-a3d385c23f30'::uuid
    and (o.activo is true or p_include_inactive)), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_daily_print_context(p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare anchor public.production_station_reports; result jsonb;
begin
 if auth.uid() is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','records') then raise exception 'pr_forbidden';end if;
 if not exists(select 1 from public.global_system_admins where user_id=auth.uid()) and not exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active and department='production' and role in ('lider','supervisor')) then raise exception 'pr_forbidden';end if;
 select * into anchor from public.production_station_reports where id=p_report;
 if not found then raise exception 'pr_invalid';end if;
 select jsonb_build_object(
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('part_number',i.part_number,'part_name',coalesce(i.part_name,i.description),'plan_quantity',coalesce(l.shift_target,case when r.elapsed_minutes>480 then t.target_10h else t.target_8h end))), '[]') from public.production_station_reports r join public.inventory_items i on i.id=r.item_id left join public.production_live_runs l on l.id=r.live_run_id left join public.production_targets t on t.item_id=r.item_id where r.id=anchor.id or (r.station_code=anchor.station_code and r.production_date=anchor.production_date and not r.progress_draft and ((anchor.machine_session_id is not null and r.machine_session_id=anchor.machine_session_id) or (anchor.capture_group_id is not null and r.capture_group_id=anchor.capture_group_id) or (anchor.live_run_id is not null and l.session_id=(select a.session_id from public.production_live_runs a where a.id=anchor.live_run_id))))),
 'station',(select to_jsonb(w) from public.inventory_workstations w where w.code=anchor.station_code),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.uid <> 'b291183c-efd7-4686-9fb5-a3d385c23f30'::uuid and m.role in ('lider','supervisor') and o.activo),
 'author',(select jsonb_build_object('id',o.uid,'name',o.nombre,'role',(select m.role from public.global_department_memberships m where m.user_id=o.uid and m.department='production' and m.active limit 1)) from public.operadores o where o.uid=anchor.created_by),
 'codes',(select coalesce(jsonb_agg(to_jsonb(c) order by c.planned desc,c.code),'[]') from public.production_downtime_codes c where c.active)
 ) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_parameter_export(p_from date, p_to date, p_station text DEFAULT ''::text, p_search text DEFAULT ''::text, p_outside boolean DEFAULT false)
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
 ) select (select count(*) from eligible),coalesce((select jsonb_agg(x.report order by x.recorded_at desc,x.id) from (select * from eligible order by recorded_at desc,id )x),'[]') into total,reports;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t where t.deleted_at is null),'reports',reports,'total',total,'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.uid <> 'b291183c-efd7-4686-9fb5-a3d385c23f30'::uuid and o.activo and m.role in ('supervisor','lider') and nullif(trim(o.nombre),'') is not null));
end $function$;

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
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t where t.deleted_at is null),'reports',reports,'total',total,'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.uid <> 'b291183c-efd7-4686-9fb5-a3d385c23f30'::uuid and o.activo and m.role in ('supervisor','lider') and nullif(trim(o.nombre),'') is not null));
end $function$;