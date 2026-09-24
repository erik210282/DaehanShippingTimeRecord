-- A verified LOAD records one outbound box movement per product line.
-- The product catalog has two different pieces-per-box values, so movements
-- stay in boxes until the packaging type and an opening stock are recorded.
create table public.shipping_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades_realizadas(id),
  line_id uuid not null references public.shipping_lines(id),
  idx text not null,
  producto uuid not null references public.productos(id),
  part_number text not null,
  cajas_delta integer not null check (cajas_delta < 0),
  created_at timestamptz not null default now(),
  unique (idx, line_id),
  unique (actividad_id, line_id)
);
create index shipping_inventory_movements_producto_created
  on public.shipping_inventory_movements (producto, created_at desc);

alter table public.shipping_inventory_movements enable row level security;
revoke all on public.shipping_inventory_movements from anon, authenticated;
grant select on public.shipping_inventory_movements to authenticated;
create policy shipping_inventory_movements_read
  on public.shipping_inventory_movements for select to authenticated
  using (exists (select 1 from public.operadores o
                 where o.uid = (select auth.uid()) and o.activo is true));

create function public.shipping_record_outbound()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if new.estado <> 'finalizada' or old.estado = 'finalizada' then
    return new;
  end if;
  select pg_catalog.lower(a.nombre) into v_name
    from public.actividades a where a.id::text = new.actividad;
  if v_name <> 'load' or not exists (
    select 1 from public.shipping_activity_labels c
    where c.actividad_id = new.id and c.etiqueta_fin is not null
  ) then
    return new;
  end if;

  insert into public.shipping_inventory_movements
    (actividad_id, line_id, idx, producto, part_number, cajas_delta)
  select new.id, l.id, l.idx, l.producto, p.part_number, -l.cantidad_cajas
    from public.shipping_lines l
    join public.productos p on p.id = l.producto
    where l.idx = new.idx;
  return new;
end $$;

create trigger shipping_record_outbound
  after update of estado on public.actividades_realizadas
  for each row execute function public.shipping_record_outbound();

revoke all on function public.shipping_record_outbound() from public;
