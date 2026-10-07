create table if not exists rls_internal.inventory_import_backups (batch_key text primary key, created_at timestamptz not null default now(), snapshot jsonb not null);
revoke all on rls_internal.inventory_import_backups from public,anon,authenticated;
create table public.inventory_reference_rows (id bigint generated always as identity primary key,batch_key text not null,kind text not null check(kind in ('inventory','bom')),source_sheet text not null,source_row integer not null,part_number text not null,fg_part_number text,quantity numeric,uom text,status text not null,details jsonb not null,unique(batch_key,kind,source_sheet,source_row));
alter table public.inventory_reference_rows enable row level security;
create policy inventory_reference_read on public.inventory_reference_rows for select to authenticated using(rls_internal.inventory_access());
grant select on public.inventory_reference_rows to authenticated;
create table public.inventory_workstations (code text primary key,name text not null,machine_type text not null,materials jsonb not null default '[]'::jsonb,active boolean not null default true);
alter table public.inventory_workstations enable row level security;
create policy inventory_workstations_read on public.inventory_workstations for select to authenticated using(rls_internal.inventory_access());
grant select on public.inventory_workstations to authenticated;
alter table public.inventory_items drop constraint inventory_items_category_check;
alter table public.inventory_items add constraint inventory_items_category_check check(category in ('RAW','PACKAGING','SEMI','FG'));
create or replace function public.inventory_item_department() returns trigger language plpgsql set search_path='' as $$ begin new.responsible_department:=case when new.category='FG' then 'shipping' when new.category='SEMI' then 'production' else 'receiving' end; return new; end $$;

create index inventory_reference_filter_idx on public.inventory_reference_rows(batch_key,kind,status);
