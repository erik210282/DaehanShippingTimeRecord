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
