-- Catalog names remain the compatibility key used by existing workstation and parameter RPCs.
create table public.machine_types (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and length(name) between 1 and 100),
 active boolean not null default true
);
create unique index machine_types_name_ci on public.machine_types(lower(name));
alter table public.machine_types enable row level security;
revoke all on public.machine_types from public,anon,authenticated;
grant select,insert,update,delete on public.machine_types to authenticated;
grant all on public.machine_types to service_role;
create policy machine_types_read on public.machine_types for select to authenticated using(rls_internal.catalog_access());
create policy machine_types_manage on public.machine_types for all to authenticated using(rls_internal.catalog_access(true)) with check(rls_internal.catalog_access(true));
insert into public.machine_types(name) values('Assembly'),('Foaming / Turntable'),('Trim / Press'),('Forming'),('Waterjets');
-- Standardize only known aliases; preserve any custom types already in use.
update public.inventory_workstations set machine_type=case machine_type when 'Foaming' then 'Foaming / Turntable' when 'Press / Trim' then 'Trim / Press' when 'WaterJet' then 'Waterjets' else machine_type end;
update public.production_parameter_templates t set machine_types=array(select distinct case x when 'Foaming' then 'Foaming / Turntable' when 'Press / Trim' then 'Trim / Press' when 'WaterJet' then 'Waterjets' else x end from unnest(t.machine_types) x),version=version+1,updated_at=now() where machine_types && array['Foaming','Press / Trim','WaterJet'];
insert into public.machine_types(name)
select distinct btrim(x) from (select machine_type x from public.inventory_workstations union select unnest(machine_types) from public.production_parameter_templates) existing
where nullif(btrim(x),'') is not null on conflict do nothing;

create function rls_internal.machine_type_dependents() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.inventory_workstations where machine_type=old.name)
   or exists(select 1 from public.production_parameter_templates where old.name=any(machine_types)) then raise exception 'mt_in_use';end if;
  return old;
 end if;
 if new.name is distinct from old.name then
  update public.inventory_workstations set machine_type=new.name where machine_type=old.name;
  update public.production_parameter_templates set machine_types=array_replace(machine_types,old.name,new.name),version=version+1,updated_at=now() where old.name=any(machine_types);
 end if;
 return new;
end $$;
revoke all on function rls_internal.machine_type_dependents() from public,anon,authenticated;
create trigger machine_type_rename after update on public.machine_types for each row execute function rls_internal.machine_type_dependents();
create trigger machine_type_delete before delete on public.machine_types for each row execute function rls_internal.machine_type_dependents();
create trigger machine_types_changed after insert or update or delete on public.machine_types for each statement execute function rls_internal.notify_catalog_update();

create function rls_internal.validate_machine_type() returns trigger language plpgsql set search_path='' as $$
declare x text; previous text[];
begin
 if tg_table_name='inventory_workstations' then
  if tg_op='UPDATE' and new.machine_type is not distinct from old.machine_type then return new;end if;
  perform 1 from public.machine_types where name=new.machine_type and (active or pg_trigger_depth()>1) for share;
  if not found then raise exception 'mt_invalid';end if;
 else
  if tg_op='UPDATE' then previous:=old.machine_types;
  else select machine_types into previous from public.production_parameter_templates where id=new.id;end if;
  previous:=coalesce(previous,array[]::text[]);
  if cardinality(new.machine_types)=0 then raise exception 'mt_invalid';end if;
  foreach x in array new.machine_types loop
   perform 1 from public.machine_types where name=x and (active or x=any(previous) or pg_trigger_depth()>1) for share;
   if not found then raise exception 'mt_invalid';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function rls_internal.validate_machine_type() from public,anon,authenticated;
create trigger validate_machine_type before insert or update of machine_type on public.inventory_workstations for each row execute function rls_internal.validate_machine_type();
create trigger validate_machine_type before insert or update of machine_types on public.production_parameter_templates for each row execute function rls_internal.validate_machine_type();

-- Three distinct event IDs share reporting code D1. Duration still depends only on fixed_type.
alter table public.production_downtime_codes drop constraint production_downtime_codes_code_key;
create unique index production_downtime_custom_code on public.production_downtime_codes(code) where fixed_type is null;
alter table public.production_downtime_codes disable trigger protect_fixed_downtime_code;
update public.production_downtime_codes set code='D1' where fixed_type in ('break','lunch');
alter table public.production_downtime_codes enable trigger protect_fixed_downtime_code;

-- Read profiles through a private helper to avoid recursive membership/profile RLS.
create function rls_internal.can_read_person(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (target=auth.uid() or
 exists(select 1 from public.operadores where uid=auth.uid() and activo and (
 exists(select 1 from public.global_system_admins where user_id=auth.uid()) or
 exists(select 1 from public.global_department_memberships mine join public.global_department_memberships theirs on theirs.department=mine.department
 where mine.user_id=auth.uid() and mine.active and theirs.user_id=target and theirs.active
 and (mine.role='supervisor' or not exists(select 1 from public.global_department_memberships s where s.user_id=auth.uid() and s.active and s.role='supervisor'))))));
$$;
revoke all on function rls_internal.can_read_person(uuid) from public,anon;
grant execute on function rls_internal.can_read_person(uuid) to authenticated;
-- Replace all legacy broad policies, including the public ALL policy.
do $$ declare p record;begin for p in select policyname from pg_policies where schemaname='public' and tablename='operadores' loop execute format('drop policy %I on public.operadores',p.policyname);end loop;end $$;
alter table public.operadores enable row level security;
revoke all on public.operadores from public,anon,authenticated;
grant select on public.operadores to authenticated;
grant all on public.operadores to service_role;
create policy operadores_scoped_read on public.operadores for select to authenticated using(rls_internal.can_read_person(uid));

-- A supervisor cannot attach an unrelated, guessed user ID to their department.
-- New accounts are created and assigned together by the authenticated global-user-admin endpoint.
create function rls_internal.can_assign_person(target uuid,dept text) returns boolean language sql stable security definer set search_path='' as $$
 select global_private.can_manage_department(dept) and (
 exists(select 1 from public.global_system_admins where user_id=auth.uid()) or
 (target<>auth.uid() and not exists(select 1 from public.global_system_admins where user_id=target)
 and exists(select 1 from public.global_department_memberships theirs join public.global_department_memberships mine on mine.department=theirs.department where theirs.user_id=target and theirs.active and mine.user_id=auth.uid() and mine.active and mine.role='supervisor')));
$$;
revoke all on function rls_internal.can_assign_person(uuid,text) from public,anon;
grant execute on function rls_internal.can_assign_person(uuid,text) to authenticated;
create policy memberships_scope_guard on public.global_department_memberships as restrictive for all to authenticated
 using(user_id=auth.uid() or global_private.can_manage_department(department))
 with check(rls_internal.can_assign_person(user_id,department));

do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.machine_types;end if;
end $$;
