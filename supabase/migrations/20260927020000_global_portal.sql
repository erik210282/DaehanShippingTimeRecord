-- Additive migration on the existing Supabase project. Shipping tables and records are untouched.

create table public.global_system_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.global_department_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  department text not null check (department in ('shipping', 'production', 'quality', 'receiving', 'inventory')),
  role text not null check (role in ('operador', 'lider', 'supervisor')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, department)
);

create table public.global_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 140),
  body text not null check (length(btrim(body)) between 1 and 10000),
  audience text not null check (audience in ('all', 'user')),
  target_user_id uuid references auth.users(id),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint announcement_target_matches_audience check (
    (audience = 'all' and target_user_id is null) or
    (audience = 'user' and target_user_id is not null)
  ),
  constraint announcement_valid_dates check (ends_at is null or ends_at > starts_at)
);

create table public.global_announcement_receipts (
  announcement_id uuid not null references public.global_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index global_department_memberships_department on public.global_department_memberships(department) where active;
create index global_announcements_live on public.global_announcements(active, starts_at, ends_at);
create index global_announcements_target on public.global_announcements(target_user_id) where audience = 'user';
create index global_announcement_receipts_user on public.global_announcement_receipts(user_id);

alter table public.global_system_admins enable row level security;
alter table public.global_department_memberships enable row level security;
alter table public.global_announcements enable row level security;
alter table public.global_announcement_receipts enable row level security;

revoke all on public.global_system_admins from anon, authenticated;
revoke all on public.global_department_memberships from anon, authenticated;
revoke all on public.global_announcements from anon, authenticated;
revoke all on public.global_announcement_receipts from anon, authenticated;
grant select on public.global_system_admins to authenticated;
grant select, insert, update, delete on public.global_department_memberships to authenticated;
grant select, insert, update on public.global_announcements to authenticated;
grant select, insert on public.global_announcement_receipts to authenticated;

-- Existing active Shipping supervisors become global admins. Clients cannot grant themselves admin privileges.
create policy global_admin_self_read on public.global_system_admins
  for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true
  ));

create policy global_memberships_read on public.global_department_memberships
  for select to authenticated
  using (
    exists (select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true)
    and (user_id = (select auth.uid()) or exists (
      select 1 from public.global_system_admins a where a.user_id = (select auth.uid())
    ))
  );
create policy global_memberships_insert on public.global_department_memberships
  for insert to authenticated with check (
    exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
    and exists (select 1 from public.operadores o where o.uid = user_id)
  );
create policy global_memberships_update on public.global_department_memberships
  for update to authenticated
  using (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
    and exists (select 1 from public.operadores o where o.uid = user_id));
create policy global_memberships_delete on public.global_department_memberships
  for delete to authenticated
  using (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid())));

create policy global_announcements_read on public.global_announcements
  for select to authenticated
  using (
    exists (select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true)
    and (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
      or (active and starts_at <= now() and (ends_at is null or ends_at > now())
        and (audience = 'all' or target_user_id = (select auth.uid()))))
  );
create policy global_announcements_insert on public.global_announcements
  for insert to authenticated with check (
    exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid()))
    and created_by = (select auth.uid())
  );
create policy global_announcements_update on public.global_announcements
  for update to authenticated
  using (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.global_system_admins a where a.user_id = (select auth.uid())));

create policy global_receipts_self_read on public.global_announcement_receipts
  for select to authenticated using (user_id = (select auth.uid()) and exists (
    select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true
  ));
create policy global_receipts_self_insert on public.global_announcement_receipts
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.operadores o where o.uid = (select auth.uid()) and o.activo is true)
    and exists (select 1 from public.global_announcements a where a.id = announcement_id
      and a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      and (a.audience = 'all' or a.target_user_id = (select auth.uid())))
  );

-- Preserve current Shipping access for every active operator with an auth account.
insert into public.global_department_memberships (user_id, department, role)
select distinct o.uid, 'shipping', case when o.role = 'supervisor' then 'supervisor' else 'operador' end
from public.operadores o join auth.users u on u.id = o.uid
where o.uid is not null and o.activo is true
on conflict (user_id, department) do nothing;

insert into public.global_system_admins (user_id)
select distinct o.uid from public.operadores o join auth.users u on u.id = o.uid
where o.uid is not null and o.activo is true and o.role = 'supervisor'
on conflict (user_id) do nothing;
