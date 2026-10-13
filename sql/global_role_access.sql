create table public.global_role_activity_catalog(
 department text not null,activity text not null,allowed_roles text[] not null,default_roles text[] not null,
 primary key(department,activity));
create table public.global_role_access_profiles(
 department text not null check(department in ('shipping','production','receiving','inventory','quality')),
 role text not null check(role in ('operador','lider','supervisor')),activities text[] not null,
 version integer not null default 1,updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),primary key(department,role));
alter table public.global_role_activity_catalog enable row level security;
alter table public.global_role_access_profiles enable row level security;
revoke all on public.global_role_activity_catalog,public.global_role_access_profiles from public,anon,authenticated;
grant select on public.global_role_activity_catalog,public.global_role_access_profiles to authenticated;
create policy role_catalog_read on public.global_role_activity_catalog for select to authenticated using ((select public.inventory_access()));
create policy role_profiles_read on public.global_role_access_profiles for select to authenticated using ((select public.inventory_access()));
create trigger role_profiles_changed after insert or update or delete on public.global_role_access_profiles for each statement execute function rls_internal.notify_catalog_update();
insert into public.global_role_activity_catalog(department,activity,allowed_roles,default_roles) values
('production','dashboard',array['operador','lider','supervisor']::text[],array['lider','supervisor']::text[]),
('production','partial',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('production','records',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('production','summary',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('production','targets',array['supervisor']::text[],array['supervisor']::text[]),
('production','materials',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('production','shifts',array['lider','supervisor']::text[],array['lider','supervisor']::text[]),
('production','parameters',array['lider','supervisor']::text[],array['lider','supervisor']::text[]),
('production','parameter-settings',array['supervisor']::text[],array['supervisor']::text[]),
('receiving','pending',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('receiving','unload',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('receiving','putaway',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('receiving','summary',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('receiving','productivity',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','overview',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','RAW',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','WIP',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','FG',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','PACKAGING',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','bom',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','demand',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','counts',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','dispatch',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('inventory','quality',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','start',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','finish',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','pending',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','summary',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','records',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','bol',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','productivity',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('shipping','tasks-settings',array['supervisor']::text[],array['supervisor']::text[]),
('quality','overview',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('quality','quality',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]),
('quality','counts',array['operador','lider','supervisor']::text[],array['operador','lider','supervisor']::text[]);
insert into public.global_role_access_profiles(department,role,activities)
 select department,role,array_agg(activity order by activity) from public.global_role_activity_catalog cross join unnest(default_roles) role group by department,role;
create or replace function rls_internal.role_activity_access(p_department text,p_activity text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.inventory_access() and (exists(select 1 from public.global_system_admins where user_id=auth.uid()) or exists(
 select 1 from public.global_department_memberships m join public.global_role_access_profiles p on p.role=m.role and p.department=p_department
 where m.user_id=auth.uid() and m.active and (m.department=p_department or p_department='inventory') and p_activity=any(p.activities)));
$$;
create or replace function rls_internal.save_role_access(p_department text,p_role text,p_activities text[],p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_admin boolean;current_version integer;
begin
 actor_admin:=exists(select 1 from public.global_system_admins where user_id=auth.uid());
 if not public.inventory_access() or not (actor_admin or public.inventory_access(p_department,true) and p_role in ('operador','lider')) then raise exception 'ra_denied';end if;
 if p_activities is null or cardinality(p_activities)>100 or p_role not in ('operador','lider','supervisor') or exists(select 1 from unnest(p_activities)a where not exists(select 1 from public.global_role_activity_catalog c where c.department=p_department and c.activity=a and p_role=any(c.allowed_roles))) then raise exception 'ra_invalid';end if;
 select version into current_version from public.global_role_access_profiles where department=p_department and role=p_role for update;
 if current_version is null then raise exception 'ra_invalid';end if;
 if current_version is distinct from p_version then raise exception 'ra_changed';end if;
 update public.global_role_access_profiles set activities=array(select distinct unnest(p_activities)),version=version+1,updated_by=auth.uid(),updated_at=now() where department=p_department and role=p_role;
 return jsonb_build_object('saved',true);
end $$;
create or replace function public.save_role_access(p_department text,p_role text,p_activities text[],p_version integer)
returns jsonb language sql set search_path='' as $$select rls_internal.save_role_access(p_department,p_role,p_activities,p_version)$$;
revoke all on function rls_internal.role_activity_access(text,text),rls_internal.save_role_access(text,text,text[],integer),public.save_role_access(text,text,text[],integer) from public,anon;
grant execute on function rls_internal.role_activity_access(text,text),rls_internal.save_role_access(text,text,text[],integer),public.save_role_access(text,text,text[],integer) to authenticated;
