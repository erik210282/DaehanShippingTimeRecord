-- Receiving: additive schema; Shipping objects are not modified.
create table public.receiving_suppliers (
 id uuid primary key default gen_random_uuid(), code text not null unique check(length(btrim(code))>0),
 name text not null check(length(btrim(name))>0), active boolean not null default true
);
create table public.receiving_locations (
 id uuid primary key default gen_random_uuid(), code text not null unique check(length(btrim(code))>0),
 name text not null check(length(btrim(name))>0), area text not null default '',
 kind text not null check(kind in ('RECEIVING','STORAGE','QUALITY')), active boolean not null default true
);
create table public.receiving_item_locations (
 item_id uuid not null references public.inventory_items(id), location_id uuid not null references public.receiving_locations(id),
 primary key(item_id,location_id)
);
create index receiving_item_locations_destination on public.receiving_item_locations(location_id);
create table public.receiving_receipts (
 id uuid primary key, code bigint generated always as identity unique,
 supplier_id uuid not null references public.receiving_suppliers(id), manifest text not null check(length(btrim(manifest))>0),
 trailer text not null check(length(btrim(trailer))>0), dock text not null check(dock ~ '^[0-9]+$'),
 staging_id uuid not null references public.receiving_locations(id),
 status text not null default 'unloading' check(status in ('unloading','received','cancelled')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), received_at timestamptz
);
create table public.receiving_lines (
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.receiving_receipts(id),
 item_id uuid not null references public.inventory_items(id), lot text not null default '',
 expected numeric not null check(expected>0), received numeric not null default 0 check(received>=0),
 damaged numeric not null default 0 check(damaged>=0 and damaged<=received), note text not null default '',
 hold_id uuid references public.inventory_quality_holds(id), unique(receipt_id,item_id,lot)
);
create index receiving_lines_item on public.receiving_lines(item_id);
create index receiving_lines_hold on public.receiving_lines(hold_id) where hold_id is not null;
create table public.receiving_tasks (
 id uuid primary key, receipt_id uuid not null references public.receiving_receipts(id),
 kind text not null check(kind in ('unload','putaway')), line_id uuid references public.receiving_lines(id),
 location_id uuid references public.receiving_locations(id), quantity numeric,
 operator_id uuid not null references auth.users(id),
 status text not null default 'running' check(status in ('running','paused','finished','cancelled')),
 started_at timestamptz not null default now(), finished_at timestamptz, paused_at timestamptz,
 pause_seconds numeric not null default 0 check(pause_seconds>=0),
 check((kind='unload' and line_id is null and location_id is null and quantity is null)
 or (kind='putaway' and line_id is not null and location_id is not null and quantity>0))
);
create unique index receiving_tasks_operator_active on public.receiving_tasks(operator_id,kind) where status in ('running','paused');
create unique index receiving_tasks_unload on public.receiving_tasks(receipt_id) where kind='unload';
create index receiving_tasks_receipt on public.receiving_tasks(receipt_id);
create index receiving_tasks_line on public.receiving_tasks(line_id) where line_id is not null;
create index receiving_tasks_location on public.receiving_tasks(location_id) where location_id is not null;
create index receiving_receipts_supplier on public.receiving_receipts(supplier_id);
create index receiving_receipts_staging on public.receiving_receipts(staging_id);
create index receiving_receipts_created_by on public.receiving_receipts(created_by);
create index receiving_receipts_date on public.receiving_receipts(created_at desc);

-- Private transaction functions preserve inventory invariants. Public RPCs are invokers.
-- All privileged entry points explicitly check the current active user's department and role.
create function rls_internal.receiving_access(p_manage boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.operadores where uid=auth.uid() and activo)
 and (exists(select 1 from public.global_system_admins where user_id=auth.uid())
 or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active
 and department='receiving' and (not p_manage or role in ('lider','supervisor'))));
$$;
create function rls_internal.receiving_catalog(p_kind text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid := coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
begin
 if not rls_internal.receiving_access(true) then raise exception 'receiving_forbidden'; end if;
 if p_kind='supplier' then
 insert into public.receiving_suppliers(id,code,name,active) values(v_id,upper(btrim(p_data->>'code')),btrim(p_data->>'name'),coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set code=excluded.code,name=excluded.name,active=excluded.active;
 elsif p_kind='location' then
 insert into public.receiving_locations(id,code,name,area,kind,active) values(v_id,upper(btrim(p_data->>'code')),btrim(p_data->>'name'),coalesce(p_data->>'area',''),p_data->>'kind',coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set code=excluded.code,name=excluded.name,area=excluded.area,kind=excluded.kind,active=excluded.active;
 elsif p_kind='item' then
 if p_data->>'category' not in ('RAW','PACKAGING') or nullif(btrim(p_data->>'uom'),'') is null
 or exists(select 1 from public.inventory_items where id=v_id and (category='FG' or producto_id is not null)) then raise exception 'receiving_invalid'; end if;
 if exists(select 1 from public.inventory_items where id=v_id and (category<>p_data->>'category' or uom<>upper(btrim(p_data->>'uom'))))
 and (exists(select 1 from public.inventory_movements where item_id=v_id) or exists(select 1 from public.receiving_lines where item_id=v_id)) then raise exception 'receiving_item_locked'; end if;
 insert into public.inventory_items(id,part_number,description,category,uom,responsible_department,active)
 values(v_id,upper(btrim(p_data->>'part_number')),coalesce(p_data->>'description',''),p_data->>'category',upper(btrim(p_data->>'uom')),'receiving',coalesce((p_data->>'active')::boolean,true))
 on conflict(id) do update set part_number=excluded.part_number,description=excluded.description,category=excluded.category,uom=excluded.uom,active=excluded.active;
 if jsonb_typeof(coalesce(p_data->'locations','[]'::jsonb)) is distinct from 'array'
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb)) a(value)
 where not exists(select 1 from public.receiving_locations where id=value::uuid and kind='STORAGE')) then raise exception 'receiving_location'; end if;
 delete from public.receiving_item_locations where item_id=v_id;
 insert into public.receiving_item_locations(item_id,location_id)
 select v_id,value::uuid from jsonb_array_elements_text(coalesce(p_data->'locations','[]'::jsonb))
 ;
 else raise exception 'receiving_invalid'; end if;
 return v_id;
end $$;

create function rls_internal.receiving_start(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 if v_operator<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if not exists(select 1 from public.operadores o where o.uid=v_operator and o.activo and
 (exists(select 1 from public.global_department_memberships where user_id=v_operator and department='receiving' and active)
 or exists(select 1 from public.global_system_admins where user_id=v_operator))) then raise exception 'receiving_invalid_operator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_receipts where id=p_id and created_by=auth.uid()) then return p_id; end if;
 if not exists(select 1 from public.receiving_suppliers where id=(p_data->>'supplier_id')::uuid and active)
 or not exists(select 1 from public.receiving_locations where id=(p_data->>'staging_id')::uuid and active and kind='RECEIVING')
 or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_receipts(id,supplier_id,manifest,trailer,dock,staging_id,created_by)
 values(p_id,(p_data->>'supplier_id')::uuid,btrim(p_data->>'manifest'),upper(btrim(p_data->>'trailer')),p_data->>'dock',(p_data->>'staging_id')::uuid,auth.uid());
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
 if not exists(select 1 from public.inventory_items where id=(v_line->>'item_id')::uuid and active and category in ('RAW','PACKAGING')) then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_lines(receipt_id,item_id,lot,expected) values(p_id,(v_line->>'item_id')::uuid,upper(btrim(coalesce(v_line->>'lot',''))),(v_line->>'expected')::numeric);
 end loop;
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id) values(p_id,p_id,'unload',v_operator);
 return p_id;
end $$;

create function rls_internal.receiving_putaway(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line public.receiving_lines%rowtype; v_reserved numeric;
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_tasks where id=p_id and operator_id=auth.uid()) then return p_id; end if;
 select * into v_line from public.receiving_lines where id=p_line for update;
 if not found or not exists(select 1 from public.receiving_receipts where id=v_line.receipt_id and status='received') then raise exception 'receiving_invalid'; end if;
 select coalesce(sum(quantity),0) into v_reserved from public.receiving_tasks where line_id=p_line and status<>'cancelled';
 if p_quantity is null or p_quantity<=0 or p_quantity>v_line.received-v_reserved then raise exception 'receiving_quantity'; end if;
 if not exists(select 1 from public.receiving_locations where id=p_location and active and kind='STORAGE') then raise exception 'receiving_location'; end if;
 if exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id)
 and not exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id and location_id=p_location) then raise exception 'receiving_location'; end if;
 insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id)
 values(p_id,v_line.receipt_id,'putaway',p_line,p_location,p_quantity,auth.uid());
 return p_id;
end $$;

create function rls_internal.receiving_task(p_id uuid,p_action text,p_lines jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_task public.receiving_tasks%rowtype; v_receipt public.receiving_receipts%rowtype;
 v_line public.receiving_lines%rowtype; v_data jsonb; v_area text; v_received numeric; v_damaged numeric; v_item record;
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 -- Consistent locking order with start/hold: receipt or line, then task.
 select * into v_task from public.receiving_tasks where id=p_id;
 if not found then raise exception 'receiving_invalid'; end if;
 if v_task.kind='putaway' then perform 1 from public.receiving_lines where id=v_task.line_id for update;
 else perform 1 from public.receiving_receipts where id=v_task.receipt_id for update; end if;
 select * into v_task from public.receiving_tasks where id=p_id for update;
 if v_task.operator_id<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if (v_task.status='finished' and p_action='finish') or (v_task.status='cancelled' and p_action='cancel')
 or (v_task.status='paused' and p_action='pause') or (v_task.status='running' and p_action='resume') then return p_id; end if;
 if v_task.status not in ('running','paused') then raise exception 'receiving_closed'; end if;
 if p_action='pause' and v_task.status='running' then
 update public.receiving_tasks set status='paused',paused_at=now() where id=p_id;
 elsif p_action='resume' and v_task.status='paused' then
 update public.receiving_tasks set status='running',pause_seconds=pause_seconds+extract(epoch from now()-paused_at),paused_at=null where id=p_id;
 elsif p_action in ('finish','cancel') then
 select * into v_receipt from public.receiving_receipts where id=v_task.receipt_id;
 if p_action='finish' and v_task.kind='unload' then
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<>(select count(*) from public.receiving_lines where receipt_id=v_receipt.id)
 or (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines)
 then raise exception 'receiving_invalid'; end if;
 for v_line in select * from public.receiving_lines where receipt_id=v_receipt.id for update loop
 select value into v_data from jsonb_array_elements(p_lines) where value->>'id'=v_line.id::text;
 v_received:=(v_data->>'received')::numeric; v_damaged:=(v_data->>'damaged')::numeric;
 if v_received is null or v_damaged is null or v_received<0 or v_damaged<0 or v_damaged>v_received
 or v_received::text in ('NaN','Infinity','-Infinity') or v_damaged::text in ('NaN','Infinity','-Infinity')
 or (v_damaged>0 and nullif(btrim(v_data->>'note'),'') is null) then raise exception 'receiving_quantity'; end if;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 update public.receiving_lines set received=v_received,damaged=v_damaged,note=coalesce(v_data->>'note','') where id=v_line.id;
 if v_received>0 then
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,note,created_by)
 select v_line.item_id,v_area,v_received,'RECEIPT',code,v_line.lot,'receiving:'||v_line.id,coalesce(v_data->>'note',''),auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 end if;
 end loop;
 update public.receiving_receipts set status='received',received_at=now() where id=v_receipt.id;
 elsif p_action='finish' and v_task.kind='putaway' then
 select * into v_line from public.receiving_lines where id=v_task.line_id;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 if exists(select 1 from public.inventory_quality_holds where id=v_line.hold_id and status='held') then v_area:='HOLD'; end if;
 -- Equal debit and credit: putaway never receives the stock a second time.
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,-v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-out:'||p_id,auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-in:'||p_id,auth.uid() from public.receiving_locations where id=v_task.location_id;
 elsif p_action='cancel' and v_task.kind='unload' then
 update public.receiving_receipts set status='cancelled' where id=v_receipt.id;
 end if;
 update public.receiving_tasks set status=case when p_action='finish' then 'finished' else 'cancelled' end,
 finished_at=now(),pause_seconds=pause_seconds+case when paused_at is not null then extract(epoch from now()-paused_at) else 0 end,paused_at=null where id=p_id;
 else raise exception 'receiving_invalid'; end if;
 return p_id;
end $$;

create function rls_internal.receiving_hold(p_line uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_line public.receiving_lines%rowtype; v_area text; v_hold uuid;
begin
 if not (rls_internal.inventory_access('quality') or rls_internal.inventory_access('receiving',true)) then raise exception 'receiving_forbidden'; end if;
 select * into v_line from public.receiving_lines where id=p_line for update;
 if not found or v_line.received<=0 or nullif(btrim(p_reason),'') is null then raise exception 'receiving_invalid'; end if;
 if exists(select 1 from public.inventory_quality_holds where id=v_line.hold_id and status='held') then return v_line.hold_id; end if;
 if exists(select 1 from public.inventory_quality_holds where id=v_line.hold_id and status='rejected') then raise exception 'receiving_closed'; end if;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 perform pg_advisory_xact_lock(hashtextextended(v_line.item_id::text||':'||v_area,0));
 if (select coalesce(sum(quantity_delta),0) from public.inventory_movements where item_id=v_line.item_id and area=v_area)<v_line.received then raise exception 'receiving_quantity'; end if;
 insert into public.inventory_quality_holds(item_id,source_area,quantity,reason,lot,created_by)
 values(v_line.item_id,v_area,v_line.received,p_reason,v_line.lot,auth.uid()) returning id into v_hold;
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
 values(v_line.item_id,v_area,-v_line.received,'QUALITY_HOLD','hold-source:'||v_hold,p_reason,v_line.lot,auth.uid()),
 (v_line.item_id,'HOLD',v_line.received,'QUALITY_HOLD','hold:'||v_hold,p_reason,v_line.lot,auth.uid());
 update public.receiving_lines set hold_id=v_hold where id=p_line;
 return v_hold;
end $$;

create function rls_internal.receiving_users() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('uid',o.uid,'nombre',o.nombre,'activo',o.activo,'role',coalesce(m.role,'supervisor'),'assigned',coalesce(m.active,false)) order by o.nombre),'[]'::jsonb)
 from public.operadores o left join public.global_department_memberships m on m.user_id=o.uid and m.department='receiving'
 where (rls_internal.receiving_access() or rls_internal.inventory_access('quality'))
 and (m.user_id is not null or exists(select 1 from public.receiving_tasks where operator_id=o.uid));
$$;

-- Read policies only; all operational mutations use checked atomic RPCs.
do $$ declare v_table text; begin
 foreach v_table in array array['receiving_suppliers','receiving_locations','receiving_item_locations','receiving_receipts','receiving_lines','receiving_tasks'] loop
 execute format('alter table public.%I enable row level security',v_table);
 execute format('revoke all on public.%I from anon,authenticated',v_table);
 execute format('grant select on public.%I to authenticated',v_table);
 execute format('create policy receiving_read on public.%I for select to authenticated using (rls_internal.receiving_access() or rls_internal.inventory_access(''quality''))',v_table);
 end loop;
end $$;

create view public.receiving_line_status with(security_invoker=true) as
 select l.*, i.part_number,i.description,i.category,i.uom,
 coalesce(h.status,'available') as quality_status,h.reason as hold_reason,
 coalesce(t.stored,0) as stored,coalesce(t.reserved,0) as reserved,
 l.received-coalesce(t.reserved,0) as available_to_store
 from public.receiving_lines l join public.inventory_items i on i.id=l.item_id
 left join public.inventory_quality_holds h on h.id=l.hold_id
 left join lateral(select sum(quantity) filter(where status='finished') as stored,
 sum(quantity) filter(where status<>'cancelled') as reserved from public.receiving_tasks where line_id=l.id) t on true;
grant select on public.receiving_line_status to authenticated;
revoke all on public.receiving_line_status from anon;

revoke all on function rls_internal.receiving_access(boolean) from public,anon;
grant execute on function rls_internal.receiving_access(boolean) to authenticated;

create function public.receiving_catalog(p_kind text,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_catalog($1,$2); $$;
revoke all on function rls_internal.receiving_catalog(text,jsonb) from public,anon;
revoke all on function public.receiving_catalog(text,jsonb) from public,anon;
grant execute on function rls_internal.receiving_catalog(text,jsonb) to authenticated;
grant execute on function public.receiving_catalog(text,jsonb) to authenticated;

create function public.receiving_start(p_id uuid,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_start($1,$2); $$;
revoke all on function rls_internal.receiving_start(uuid,jsonb) from public,anon;
revoke all on function public.receiving_start(uuid,jsonb) from public,anon;
grant execute on function rls_internal.receiving_start(uuid,jsonb) to authenticated;
grant execute on function public.receiving_start(uuid,jsonb) to authenticated;

create function public.receiving_putaway(p_id uuid,p_line uuid,p_location uuid,p_quantity numeric) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_putaway($1,$2,$3,$4); $$;
revoke all on function rls_internal.receiving_putaway(uuid,uuid,uuid,numeric) from public,anon;
revoke all on function public.receiving_putaway(uuid,uuid,uuid,numeric) from public,anon;
grant execute on function rls_internal.receiving_putaway(uuid,uuid,uuid,numeric) to authenticated;
grant execute on function public.receiving_putaway(uuid,uuid,uuid,numeric) to authenticated;

create function public.receiving_task(p_id uuid,p_action text,p_lines jsonb default '[]'::jsonb) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_task($1,$2,$3); $$;
revoke all on function rls_internal.receiving_task(uuid,text,jsonb) from public,anon;
revoke all on function public.receiving_task(uuid,text,jsonb) from public,anon;
grant execute on function rls_internal.receiving_task(uuid,text,jsonb) to authenticated;
grant execute on function public.receiving_task(uuid,text,jsonb) to authenticated;

create function public.receiving_hold(p_line uuid,p_reason text) returns uuid language sql security invoker set search_path='' as $$ select rls_internal.receiving_hold($1,$2); $$;
revoke all on function rls_internal.receiving_hold(uuid,text) from public,anon;
revoke all on function public.receiving_hold(uuid,text) from public,anon;
grant execute on function rls_internal.receiving_hold(uuid,text) to authenticated;
grant execute on function public.receiving_hold(uuid,text) to authenticated;

create function public.receiving_users() returns jsonb language sql security invoker set search_path='' as $$ select rls_internal.receiving_users(); $$;
revoke all on function rls_internal.receiving_users() from public,anon;
revoke all on function public.receiving_users() from public,anon;
grant execute on function rls_internal.receiving_users() to authenticated;
grant execute on function public.receiving_users() to authenticated;

alter table public.receiving_lines add constraint receiving_lines_finite check(expected::text not in ('NaN','Infinity','-Infinity') and received::text not in ('NaN','Infinity','-Infinity') and damaged::text not in ('NaN','Infinity','-Infinity'));
alter table public.receiving_tasks add constraint receiving_tasks_finite check(quantity is null or quantity::text not in ('NaN','Infinity','-Infinity'));
