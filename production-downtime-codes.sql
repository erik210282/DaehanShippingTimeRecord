begin;
create table if not exists public.production_downtime_codes (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[A-Z0-9_-]{1,20}$'),
 name text not null check(length(btrim(name)) between 1 and 160),
 planned boolean not null,
 fixed_type text unique check(fixed_type in ('break','lunch')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.production_downtime_codes enable row level security;
revoke all on public.production_downtime_codes from anon;
grant select,insert,update,delete on public.production_downtime_codes to authenticated;
create policy production_downtime_read on public.production_downtime_codes for select to authenticated using (public.inventory_access('production'));
create policy production_downtime_manage on public.production_downtime_codes for all to authenticated using (public.inventory_access('production',true) and rls_internal.role_activity_access('production','parameter-settings')) with check (public.inventory_access('production',true) and rls_internal.role_activity_access('production','parameter-settings'));
insert into public.production_downtime_codes(code,name,planned,fixed_type) values('BREAK','Break',true,'break'),('LUNCH','Lunch',true,'lunch') on conflict(code) do nothing;
insert into public.production_downtime_codes(code,name,planned) values
 ('D1','Training / Meetings',true),('D2','Electricity Cutting / General Cleaning',true),('D3','Preventive Maintenance',true),('D4','Make Copies',true),('D5','Testing Performance',true),('D6','Others',true),
 ('F1','Sample Making',false),('F2','General Cleaning',false),('F3','Mold Cleaning',false),('F4','Mold Change',false),('F5','Machine Condition Adjustment',false),('F6','Mold Repair',false),('F7','Machine Repair',false),('F8','Lack of Material / Material Change',false),('F9','Quality Inspection',false),('F10','Waterjet Repair',false),('F11','Glue Machine Repair',false),('F12','Others',false) on conflict(code) do nothing;
create or replace function rls_internal.protect_fixed_downtime_code() returns trigger language plpgsql set search_path='' as $$
begin
 if old.fixed_type is not null then raise exception 'dt_fixed_locked';end if;
 if tg_op='UPDATE' and new.fixed_type is not null then raise exception 'dt_fixed_locked';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger protect_fixed_downtime_code before update or delete on public.production_downtime_codes for each row execute function rls_internal.protect_fixed_downtime_code();
-- Code, name and category remain snapshots inside historical JSON events.
commit;
