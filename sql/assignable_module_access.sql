-- Assign Catalogs and Settings independently while preserving existing access.
alter table public.global_department_memberships drop constraint global_department_memberships_department_check;
alter table public.global_department_memberships add constraint global_department_memberships_department_check check(department in ('shipping','production','quality','receiving','inventory','catalogs','settings'));
insert into public.global_department_memberships(user_id,department,role,active)
 select user_id,'catalogs',case max(case role when 'supervisor' then 3 when 'lider' then 2 else 1 end) when 3 then 'supervisor' when 2 then 'lider' else 'operador' end,true
 from public.global_department_memberships where active and department in ('shipping','production','quality','receiving','inventory')
 group by user_id on conflict(user_id,department) do nothing;
insert into public.global_department_memberships(user_id,department,role,active)
 select distinct user_id,'settings','supervisor',true from public.global_department_memberships where active and role='supervisor' and department in ('shipping','production','quality','receiving','inventory')
 on conflict(user_id,department) do nothing;
create or replace function rls_internal.catalog_access(p_manage boolean default false)
 returns boolean language sql stable security definer set search_path=''
 as $fn$
 select auth.uid() is not null and exists(select 1 from public.operadores where uid=auth.uid() and activo)
 and (exists(select 1 from public.global_system_admins where user_id=auth.uid())
 or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='catalogs' and active and (not p_manage or role in ('lider','supervisor'))));
 $fn$;
create or replace function global_private.can_manage_department(p_department text)
 returns boolean language sql stable security definer set search_path=''
 as $fn$
 select auth.uid() is not null and exists(select 1 from public.operadores where uid=auth.uid() and activo)
 and (exists(select 1 from public.global_system_admins where user_id=auth.uid())
 or (p_department not in ('catalogs','settings') and exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='settings' and active) and exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active and department=p_department and role='supervisor')));
 $fn$;
update public.catalog_updates set version=version+1 where id=1;

create or replace function rls_internal.save_role_access(p_department text,p_role text,p_activities text[],p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor_admin boolean;current_version integer;
begin
 actor_admin:=exists(select 1 from public.global_system_admins where user_id=auth.uid());
 if not public.inventory_access() or not (actor_admin or public.inventory_access('settings') and public.inventory_access(p_department,true) and p_role in ('operador','lider')) then raise exception 'ra_denied';end if;
 if p_activities is null or cardinality(p_activities)>100 or p_role not in ('operador','lider','supervisor') or exists(select 1 from unnest(p_activities)a where not exists(select 1 from public.global_role_activity_catalog c where c.department=p_department and c.activity=a and p_role=any(c.allowed_roles))) then raise exception 'ra_invalid';end if;
 select version into current_version from public.global_role_access_profiles where department=p_department and role=p_role for update;
 if current_version is null then raise exception 'ra_invalid';end if;
 if current_version is distinct from p_version then raise exception 'ra_changed';end if;
 update public.global_role_access_profiles set activities=array(select distinct unnest(p_activities)),version=version+1,updated_by=auth.uid(),updated_at=now() where department=p_department and role=p_role;
 return jsonb_build_object('saved',true);
end $fn$;
