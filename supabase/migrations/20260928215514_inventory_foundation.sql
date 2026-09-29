-- Inventory ledger starts from approved physical counts. Historical LOAD rows
-- remain available for audit but are never included in the new FG balance.
drop trigger if exists shipping_record_outbound on public.actividades_realizadas;

create function public.inventory_access(p_department text default null, p_supervisor boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.operadores o where o.uid = auth.uid() and o.activo is true)
    and (
      exists (select 1 from public.global_system_admins a where a.user_id = auth.uid())
      or exists (
        select 1 from public.global_department_memberships m
        where m.user_id = auth.uid() and m.active is true
          and (p_department is null or m.department = p_department)
          and (not p_supervisor or m.role = 'supervisor')
      )
    )
$$;
revoke all on function public.inventory_access(text, boolean) from public, anon;
grant execute on function public.inventory_access(text, boolean) to authenticated;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid unique references public.productos(id),
  part_number text not null unique check (length(btrim(part_number)) > 0),
  description text not null default '',
  category text not null check (category in ('RAW','PACKAGING','FG')),
  uom text not null default 'EA',
  minimum_quantity numeric not null default 0 check (minimum_quantity >= 0),
  responsible_department text not null default 'inventory'
    check (responsible_department in ('shipping','production','quality','receiving','inventory')),
  default_location text,
  unit_cost numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (producto_id is null or category = 'FG')
);

create function public.inventory_sync_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Delivery and Empty Crates use the shared placeholder NA; neither is FG stock.
  if nullif(btrim(new.part_number), '') is null or upper(btrim(new.part_number))='NA' then return new; end if;
  insert into public.inventory_items(producto_id,part_number,description,category,uom,responsible_department,active)
  values(new.id,btrim(new.part_number),coalesce(nullif(btrim(new.nombre),''),new.descripcion,''),'FG','EA','inventory',coalesce(new.activo,true))
  on conflict (producto_id) do update set
    part_number = excluded.part_number, description = excluded.description, active = excluded.active;
  return new;
end $$;
create trigger inventory_sync_product after insert or update of part_number,nombre,descripcion,activo
on public.productos for each row execute function public.inventory_sync_product();
insert into public.inventory_items(producto_id,part_number,description,category,uom,responsible_department,active)
select id,btrim(part_number),coalesce(nullif(btrim(nombre),''),descripcion,''),'FG','EA','inventory',coalesce(activo,true)
from public.productos where nullif(btrim(part_number),'') is not null and upper(btrim(part_number))<>'NA'
on conflict (producto_id) do nothing;
revoke all on function public.inventory_sync_product() from public, anon, authenticated;

create table public.inventory_boms (
  id uuid primary key default gen_random_uuid(),
  finished_item_id uuid not null references public.inventory_items(id),
  version integer not null check (version > 0),
  active boolean not null default false,
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(finished_item_id,version)
);
create unique index inventory_boms_one_active on public.inventory_boms(finished_item_id) where active;
create table public.inventory_bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.inventory_boms(id) on delete cascade,
  ingredient_id uuid not null references public.inventory_items(id),
  quantity_per_unit numeric not null check (quantity_per_unit > 0),
  waste_rate numeric not null default 0 check (waste_rate >= 0 and waste_rate < 1),
  unique(bom_id,ingredient_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  area text not null check (area in ('RAW','WIP','FG','PACKAGING','HOLD')),
  quantity_delta numeric not null check (quantity_delta <> 0),
  kind text not null check (kind in ('OPENING','RECEIPT','CONSUMPTION','WIP_IN','WIP_OUT',
    'PRODUCTION','SCRAP','SHIPMENT','COUNT_ADJUSTMENT','TRANSFER','QUALITY_HOLD','QUALITY_RELEASE','QUALITY_REJECT')),
  location text not null default '',
  lot text not null default '',
  reference_key text unique,
  note text not null default '',
  effective_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index inventory_movements_balance_idx on public.inventory_movements(item_id,area);
create index inventory_movements_date_idx on public.inventory_movements(effective_date desc);
create view public.inventory_balances with (security_invoker = true) as
  select item_id,area,sum(quantity_delta) as quantity
  from public.inventory_movements group by item_id,area;

create table public.inventory_production_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  bom_id uuid references public.inventory_boms(id),
  production_date date not null,
  good_quantity numeric not null check (good_quantity >= 0),
  waste_quantity numeric not null check (waste_quantity >= 0),
  wip_completed numeric not null default 0 check (wip_completed >= 0),
  note text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  check (good_quantity + waste_quantity > 0)
);
create table public.inventory_production_inputs (
  report_id uuid not null references public.inventory_production_reports(id),
  ingredient_id uuid not null references public.inventory_items(id),
  theoretical_quantity numeric not null check (theoretical_quantity > 0),
  primary key(report_id,ingredient_id)
);
create table public.inventory_dispatches (
  idx text primary key,
  ship_date date not null,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  note text not null default ''
);
create table public.inventory_dispatch_lines (
  idx text not null references public.inventory_dispatches(idx),
  shipping_line_id uuid not null unique references public.shipping_lines(id),
  item_id uuid not null references public.inventory_items(id),
  boxes integer not null check (boxes > 0),
  pieces_per_box numeric not null check (pieces_per_box > 0),
  pieces numeric generated always as (boxes * pieces_per_box) stored,
  primary key(idx,shipping_line_id)
);

-- Quality inspection fields can be added later. Holds already have explicit
-- release/rejection outcomes and move quantities between physical areas.
create table public.inventory_quality_holds (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  source_area text not null check (source_area in ('RAW','WIP','FG','PACKAGING')),
  quantity numeric not null check (quantity > 0),
  lot text not null default '',
  reason text not null,
  status text not null default 'held' check (status in ('held','released','rejected')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text not null default ''
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('shipping','production','quality','receiving','inventory')),
  area text not null check (area in ('RAW','WIP','FG','PACKAGING','HOLD')),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  counted_at timestamptz not null default now(),
  submitted_by uuid not null default auth.uid(),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text not null default ''
);
create unique index inventory_one_open_count on public.inventory_counts(department,area) where status = 'submitted';
create table public.inventory_count_lines (
  count_id uuid not null references public.inventory_counts(id),
  item_id uuid not null references public.inventory_items(id),
  expected_quantity numeric not null,
  physical_quantity numeric not null check (physical_quantity >= 0),
  primary key(count_id,item_id)
);

create table public.inventory_demand_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_fingerprint text not null unique,
  status text not null default 'uploading' check (status in ('uploading','active','superseded')),
  expected_rows integer not null check (expected_rows > 0),
  backlog_cutoff date,
  imported_by uuid not null default auth.uid(),
  imported_at timestamptz not null default now(),
  activated_at timestamptz
);
create unique index inventory_demand_one_active on public.inventory_demand_imports(status) where status = 'active';
create table public.inventory_demand_lines (
  import_id uuid not null references public.inventory_demand_imports(id),
  po text not null,
  po_line text not null,
  part_number text not null,
  description text not null default '',
  destination text not null default '',
  ship_date date not null,
  quantity numeric not null check (quantity >= 0),
  uom text not null default 'EA',
  release_version text,
  release_date date,
  primary key(import_id,po,po_line,part_number,ship_date)
);
create index inventory_demand_schedule on public.inventory_demand_lines(part_number,ship_date);

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_boms','inventory_bom_lines','inventory_movements',
    'inventory_production_reports','inventory_production_inputs','inventory_dispatches','inventory_dispatch_lines','inventory_quality_holds',
    'inventory_counts','inventory_count_lines','inventory_demand_imports','inventory_demand_lines'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.inventory_access())',t||'_read',t);
    if t <> 'inventory_items' then
      execute format('grant select on public.%I to authenticated',t);
    end if;
  end loop;
end $$;
grant select(id,producto_id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active,created_at)
  on public.inventory_items to authenticated;
grant select on public.inventory_balances to authenticated;

create policy inventory_items_manage on public.inventory_items for all to authenticated
  using (public.inventory_access('inventory',true))
  with check (public.inventory_access('inventory',true));
grant insert(producto_id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active),
  update(part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active)
  on public.inventory_items to authenticated;
-- Never expose unit_cost to the client while costing is disabled.

create policy inventory_boms_manage on public.inventory_boms for all to authenticated
  using (public.inventory_access('production',true) or public.inventory_access('inventory',true))
  with check ((public.inventory_access('production',true) or public.inventory_access('inventory',true))
    and active is false);
create policy inventory_bom_lines_manage on public.inventory_bom_lines for all to authenticated
  using (public.inventory_access('production',true) or public.inventory_access('inventory',true))
  with check (public.inventory_access('production',true) or public.inventory_access('inventory',true));
grant insert(finished_item_id,version,notes),update(notes) on public.inventory_boms to authenticated;
grant insert,update,delete on public.inventory_bom_lines to authenticated;
create policy inventory_demand_imports_insert on public.inventory_demand_imports for insert to authenticated
  with check (public.inventory_access('inventory',true) and imported_by = auth.uid() and status = 'uploading');
create policy inventory_demand_lines_insert on public.inventory_demand_lines for insert to authenticated
  with check (public.inventory_access('inventory',true) and exists (
    select 1 from public.inventory_demand_imports d where d.id = import_id
    and d.imported_by = auth.uid() and d.status = 'uploading'));
grant insert on public.inventory_demand_imports,public.inventory_demand_lines to authenticated;

create function public.inventory_post_movement(p_item uuid,p_area text,p_delta numeric,p_kind text,
  p_note text default '',p_location text default '',p_lot text default '',p_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_category text; v_department text;
begin
  select category,responsible_department into v_category,v_department from public.inventory_items where id=p_item and active;
  if v_category is null or not public.inventory_access(case when p_area='WIP' then 'production'
    when p_area='HOLD' then 'quality' else v_department end) then raise exception 'Sin acceso al material'; end if;
  if p_delta is null or p_delta=0 or p_area not in ('RAW','WIP','PACKAGING')
     or p_kind not in ('RECEIPT','CONSUMPTION','WIP_IN','WIP_OUT')
     or (p_kind in ('RECEIPT','WIP_IN') and p_delta<0)
     or (p_kind in ('CONSUMPTION','WIP_OUT') and p_delta>0)
     or (p_area='WIP' and v_category<>'FG')
     or (p_area='PACKAGING' and v_category<>'PACKAGING')
     or (p_area='RAW' and v_category<>'RAW')
     or p_date is null then raise exception 'Movimiento inválido'; end if;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,note,location,lot,effective_date,created_by)
  values(p_item,p_area,p_delta,p_kind,coalesce(p_note,''),coalesce(p_location,''),coalesce(p_lot,''),p_date,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.inventory_record_production(p_item uuid,p_date date,p_good numeric,
  p_waste numeric,p_wip_completed numeric default 0,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_bom uuid; v_ingredient record; v_use numeric;
begin
  if not public.inventory_access('production') or not exists
     (select 1 from public.inventory_items where id=p_item and category='FG' and active)
     or p_date is null or p_good is null or p_waste is null
     or p_good<0 or p_waste<0 or p_good+p_waste<=0
     or p_wip_completed is null or p_wip_completed<0
     then raise exception 'Reporte de producción inválido'; end if;
  select id into v_bom from public.inventory_boms where finished_item_id=p_item and active;
  insert into public.inventory_production_reports(item_id,bom_id,production_date,good_quantity,waste_quantity,wip_completed,note)
  values(p_item,v_bom,p_date,p_good,p_waste,p_wip_completed,coalesce(p_note,'')) returning id into v_id;
  if v_bom is not null then
    for v_ingredient in select l.ingredient_id,l.quantity_per_unit,l.waste_rate,i.category
      from public.inventory_bom_lines l join public.inventory_items i on i.id=l.ingredient_id
      where l.bom_id=v_bom loop
      v_use := (p_good+p_waste)*v_ingredient.quantity_per_unit*(1+v_ingredient.waste_rate);
      insert into public.inventory_production_inputs(report_id,ingredient_id,theoretical_quantity)
        values(v_id,v_ingredient.ingredient_id,v_use);
      insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
        values(v_ingredient.ingredient_id,v_ingredient.category,-v_use,'CONSUMPTION',
          'production-input:'||v_id||':'||v_ingredient.ingredient_id,
          'Consumo BOM para producción '||v_id,p_date,auth.uid());
    end loop;
  end if;
  if p_good>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
    values(p_item,'FG',p_good,'PRODUCTION','production:'||v_id,coalesce(p_note,''),p_date,auth.uid());
  end if;
  if p_wip_completed>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
    values(p_item,'WIP',-p_wip_completed,'WIP_OUT','production-wip:'||v_id,coalesce(p_note,''),p_date,auth.uid());
  end if;
  return v_id;
end $$;

create function public.inventory_confirm_dispatch(p_idx text,p_date date,p_lines jsonb,p_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare v_line record; v_count integer;
begin
  if not public.inventory_access('shipping',true) or nullif(btrim(p_idx),'') is null
     or p_date is null or p_date > (now() at time zone 'America/Los_Angeles')::date
     or jsonb_typeof(p_lines)<>'array' then raise exception 'Confirmación de envío inválida'; end if;
  if not exists (select 1 from public.actividades_realizadas r join public.actividades a
      on a.id::text=r.actividad where r.idx=p_idx and lower(a.nombre)='load' and r.estado='finalizada')
     then raise exception 'El IDX no tiene un LOAD finalizado'; end if;
  select count(*) into v_count from public.shipping_lines where idx=p_idx;
  if v_count=0 or v_count<>jsonb_array_length(p_lines) then
    raise exception 'Confirme todas las líneas del IDX'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) v
       where (v->>'pieces_per_box') is null or (v->>'pieces_per_box') !~ '^[0-9]+(\.[0-9]+)?$'
         or (v->>'pieces_per_box')::numeric<=0)
     then raise exception 'Indique piezas por caja para cada línea'; end if;
  insert into public.inventory_dispatches(idx,ship_date,confirmed_by,note)
    values(p_idx,p_date,auth.uid(),coalesce(p_note,''));
  for v_line in
    select l.id,l.producto,l.cantidad_cajas,i.id as item_id,
      (v->>'pieces_per_box')::numeric as per_box
    from jsonb_array_elements(p_lines) v
    join public.shipping_lines l on l.id=(v->>'line_id')::uuid and l.idx=p_idx
    join public.inventory_items i on i.producto_id=l.producto and i.category='FG'
  loop
    insert into public.inventory_dispatch_lines(idx,shipping_line_id,item_id,boxes,pieces_per_box)
      values(p_idx,v_line.id,v_line.item_id,v_line.cantidad_cajas,v_line.per_box);
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
      values(v_line.item_id,'FG',-(v_line.cantidad_cajas*v_line.per_box),'SHIPMENT',
        'dispatch:'||v_line.id,coalesce(p_note,''),p_date,auth.uid());
  end loop;
  if (select count(*) from public.inventory_dispatch_lines where idx=p_idx)<>v_count
    then raise exception 'Faltan líneas o productos en el catálogo'; end if;
  return p_idx;
end $$;

create function public.inventory_submit_count(p_department text,p_area text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_line jsonb; v_item uuid; v_expected numeric;
begin
  if not public.inventory_access(p_department) or p_area not in ('RAW','WIP','FG','PACKAGING','HOLD')
     or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0
     then raise exception 'Conteo inválido'; end if;
  insert into public.inventory_counts(department,area) values(p_department,p_area) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item := (v_line->>'item_id')::uuid;
    if not exists(select 1 from public.inventory_items i where i.id=v_item and i.active
      and (p_area='WIP' and p_department='production' and i.category='FG'
        or p_area='HOLD' and p_department='quality'
        or i.responsible_department=p_department
          and (p_area='FG' and i.category='FG' or p_area='RAW' and i.category='RAW'
          or p_area='PACKAGING' and i.category='PACKAGING')))
       then raise exception 'Material ajeno al departamento o área'; end if;
    select coalesce(sum(quantity_delta),0) into v_expected from public.inventory_movements
      where item_id=v_item and area=p_area;
    insert into public.inventory_count_lines(count_id,item_id,expected_quantity,physical_quantity)
      values(v_id,v_item,v_expected,(v_line->>'physical_quantity')::numeric);
  end loop;
  return v_id;
end $$;

create function public.inventory_review_count(p_count uuid,p_approve boolean,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_count public.inventory_counts%rowtype; v_line record;
begin
  select * into v_count from public.inventory_counts where id=p_count for update;
  if not found or v_count.status<>'submitted'
     or not public.inventory_access(v_count.department,true) then raise exception 'Conteo no disponible para aprobación'; end if;
  if p_approve is null then raise exception 'Indique aprobar o rechazar'; end if;
  if p_approve then
    for v_line in select * from public.inventory_count_lines where count_id=p_count loop
      if v_line.physical_quantity<>v_line.expected_quantity then
        insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
          values(v_line.item_id,v_count.area,v_line.physical_quantity-v_line.expected_quantity,
            case when not exists(select 1 from public.inventory_movements m where m.item_id=v_line.item_id and m.area=v_count.area)
              then 'OPENING' else 'COUNT_ADJUSTMENT' end,
            'count:'||p_count||':'||v_line.item_id,coalesce(p_note,''),current_date,auth.uid());
      end if;
    end loop;
  end if;
  update public.inventory_counts set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=p_count;
  return p_count;
end $$;

create function public.inventory_activate_demand(p_import uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_import public.inventory_demand_imports%rowtype;
begin
  select * into v_import from public.inventory_demand_imports where id=p_import for update;
  if not public.inventory_access('inventory',true) or not found or v_import.status<>'uploading'
     or (select count(*) from public.inventory_demand_lines where import_id=p_import)<>v_import.expected_rows
     then raise exception 'Importación incompleta o sin autorización'; end if;
  update public.inventory_demand_imports set status='superseded' where status='active';
  update public.inventory_demand_imports set status='active',activated_at=now() where id=p_import;
  return p_import;
end $$;

create function public.inventory_append_demand(p_import uuid,p_lines jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  if not public.inventory_access('inventory',true) or jsonb_typeof(p_lines)<>'array'
     or jsonb_array_length(p_lines)>250
     or not exists(select 1 from public.inventory_demand_imports
       where id=p_import and imported_by=auth.uid() and status='uploading')
     then raise exception 'Lote de demanda inválido'; end if;
  insert into public.inventory_demand_lines(import_id,po,po_line,part_number,description,
    destination,ship_date,quantity,uom,release_version,release_date)
  select p_import,x.po,x.po_line,x.part_number,coalesce(x.description,''),
    coalesce(x.destination,''),x.ship_date,x.quantity,coalesce(x.uom,'EA'),
    x.release_version,x.release_date
  from jsonb_to_recordset(p_lines) as x(po text,po_line text,part_number text,description text,
    destination text,ship_date date,quantity numeric,uom text,release_version text,release_date date)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

create function public.inventory_publish_bom(p_bom uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_item uuid;
begin
  if not (public.inventory_access('production',true) or public.inventory_access('inventory',true))
    then raise exception 'Solo un supervisor puede publicar una receta'; end if;
  select finished_item_id into v_item from public.inventory_boms where id=p_bom for update;
  if v_item is null or not exists(select 1 from public.inventory_items where id=v_item and category='FG')
    or not exists(select 1 from public.inventory_bom_lines where bom_id=p_bom)
    or exists(select 1 from public.inventory_bom_lines l join public.inventory_items i on i.id=l.ingredient_id
      where l.bom_id=p_bom and i.category not in ('RAW','PACKAGING'))
    then raise exception 'La receta requiere al menos un insumo'; end if;
  update public.inventory_boms set active=false where finished_item_id=v_item and active;
  update public.inventory_boms set active=true where id=p_bom;
  return p_bom;
end $$;

create function public.inventory_quality_hold(p_item uuid,p_area text,p_quantity numeric,p_reason text,p_lot text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.inventory_access('quality') or p_area not in ('RAW','WIP','FG','PACKAGING')
    or p_quantity is null or p_quantity<=0 or nullif(btrim(p_reason),'') is null
    or not exists(select 1 from public.inventory_items where id=p_item and active
      and (category=p_area or p_area='WIP' and category='FG'))
    then raise exception 'Retención inválida'; end if;
  insert into public.inventory_quality_holds(item_id,source_area,quantity,reason,lot,created_by)
    values(p_item,p_area,p_quantity,p_reason,coalesce(p_lot,''),auth.uid()) returning id into v_id;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
    values(p_item,p_area,-p_quantity,'QUALITY_HOLD','hold-source:'||v_id,p_reason,coalesce(p_lot,''),auth.uid()),
      (p_item,'HOLD',p_quantity,'QUALITY_HOLD','hold:'||v_id,p_reason,coalesce(p_lot,''),auth.uid());
  return v_id;
end $$;

create function public.inventory_quality_resolve(p_hold uuid,p_release boolean,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hold public.inventory_quality_holds%rowtype;
begin
  select * into v_hold from public.inventory_quality_holds where id=p_hold for update;
  if not found or v_hold.status<>'held' or not public.inventory_access('quality',true)
    or p_release is null then raise exception 'Retención no disponible para revisión'; end if;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
    values(v_hold.item_id,'HOLD',-v_hold.quantity,
      case when p_release then 'QUALITY_RELEASE' else 'QUALITY_REJECT' end,
      'hold-close:'||p_hold,coalesce(p_note,''),v_hold.lot,auth.uid());
  if p_release then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
      values(v_hold.item_id,v_hold.source_area,v_hold.quantity,'QUALITY_RELEASE',
        'hold-release:'||p_hold,coalesce(p_note,''),v_hold.lot,auth.uid());
  end if;
  update public.inventory_quality_holds set status=case when p_release then 'released' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=p_hold;
  return p_hold;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('inventory_post_movement','inventory_record_production',
      'inventory_confirm_dispatch','inventory_submit_count','inventory_review_count',
      'inventory_append_demand','inventory_activate_demand','inventory_publish_bom',
      'inventory_quality_hold','inventory_quality_resolve')
  loop
    execute 'revoke all on function '||f.signature||' from public,anon';
    execute 'grant execute on function '||f.signature||' to authenticated';
  end loop;
end $$;
