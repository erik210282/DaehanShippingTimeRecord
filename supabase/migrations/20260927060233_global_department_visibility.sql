-- Department supervisors manage only their assigned department.
-- The system admin is the existing active account with Erik's email.
create schema if not exists global_private;
grant usage on schema global_private to authenticated;

create or replace function global_private.can_manage_department(p_department text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operadores o
    where o.uid = (select auth.uid()) and o.activo is true
  ) and (
    exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
    or exists (
      select 1 from public.global_department_memberships m
      where m.user_id = (select auth.uid())
        and m.department = p_department and m.active is true and m.role = 'supervisor'
    )
  );
$$;

revoke all on function global_private.can_manage_department(text) from public, anon;
grant execute on function global_private.can_manage_department(text) to authenticated;

drop policy if exists global_memberships_read on public.global_department_memberships;
drop policy if exists global_memberships_insert on public.global_department_memberships;
drop policy if exists global_memberships_update on public.global_department_memberships;

create policy global_memberships_read on public.global_department_memberships
  for select to authenticated using (
    exists (select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true)
    and (user_id = (select auth.uid()) or global_private.can_manage_department(department))
  );

create policy global_memberships_insert on public.global_department_memberships
  for insert to authenticated with check (
    global_private.can_manage_department(department)
    and exists (select 1 from public.operadores o where o.uid = user_id and o.activo is true)
    and (
      exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
      or (user_id <> (select auth.uid()) and role in ('operador', 'lider'))
    )
  );

create policy global_memberships_update on public.global_department_memberships
  for update to authenticated
  using (
    global_private.can_manage_department(department)
    and (
      exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
      or (user_id <> (select auth.uid()) and role <> 'supervisor')
    )
  )
  with check (
    global_private.can_manage_department(department)
    and exists (select 1 from public.operadores o where o.uid = user_id)
    and (
      exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
      or (user_id <> (select auth.uid()) and role in ('operador', 'lider'))
    )
  );

delete from public.global_system_admins
where user_id not in (
  select o.uid from public.operadores o
  where lower(o.email) = 'erik@dhsc.co.kr' and o.activo is true and o.uid is not null
);

insert into public.global_system_admins (user_id)
select o.uid from public.operadores o
where lower(o.email) = 'erik@dhsc.co.kr' and o.activo is true and o.uid is not null
on conflict (user_id) do nothing;

insert into public.global_department_memberships (user_id, department, role, active)
select o.uid, d.department, 'supervisor', true
from public.operadores o
cross join (values ('shipping'), ('production'), ('quality'), ('receiving'), ('inventory')) as d(department)
where lower(o.email) = 'erik@dhsc.co.kr' and o.activo is true and o.uid is not null
on conflict (user_id, department) do update
set role = excluded.role, active = true, updated_at = now();
