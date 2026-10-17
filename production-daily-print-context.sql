begin;
create or replace function rls_internal.production_daily_print_context(p_report uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.production_station_reports; result jsonb;
begin
 if auth.uid() is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','records') then raise exception 'pr_forbidden';end if;
 if not exists(select 1 from public.global_system_admins where user_id=auth.uid()) and not exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active and department='production' and role in ('lider','supervisor')) then raise exception 'pr_forbidden';end if;
 select * into anchor from public.production_station_reports where id=p_report;
 if not found then raise exception 'pr_invalid';end if;
 select jsonb_build_object(
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('part_number',i.part_number,'part_name',coalesce(i.part_name,i.description),'plan_quantity',coalesce(l.shift_target,case when r.elapsed_minutes>480 then t.target_10h else t.target_8h end))), '[]') from public.production_station_reports r join public.inventory_items i on i.id=r.item_id left join public.production_live_runs l on l.id=r.live_run_id left join public.production_targets t on t.item_id=r.item_id where r.id=anchor.id or (anchor.capture_group_id is not null and r.capture_group_id=anchor.capture_group_id)),
 'station',(select to_jsonb(w) from public.inventory_workstations w where w.code=anchor.station_code),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and m.role in ('lider','supervisor') and o.activo),
 'author',(select jsonb_build_object('id',o.uid,'name',o.nombre,'role',(select m.role from public.global_department_memberships m where m.user_id=o.uid and m.department='production' and m.active limit 1)) from public.operadores o where o.uid=anchor.created_by),
 'codes',(select coalesce(jsonb_agg(to_jsonb(c) order by c.planned desc,c.code),'[]') from public.production_downtime_codes c where c.active)
 ) into result;
 return result;
end $$;
revoke all on function rls_internal.production_daily_print_context(uuid) from public,anon;
grant execute on function rls_internal.production_daily_print_context(uuid) to authenticated;
create or replace function public.production_daily_print_context(p_report uuid) returns jsonb language sql security invoker set search_path='' as $$select rls_internal.production_daily_print_context($1);$$;
revoke all on function public.production_daily_print_context(uuid) from public,anon;
grant execute on function public.production_daily_print_context(uuid) to authenticated;
commit;
