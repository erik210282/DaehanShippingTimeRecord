-- A planned IDX advances only after the preceding phase has been verified.
-- This also stops stale clients from opening a later phase directly.
create function public.shipping_guard_activity_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_previous text;
begin
  if not exists (select 1 from public.shipping_lines where idx = new.idx) then
    return new;
  end if;
  select pg_catalog.lower(a.nombre) into v_name
    from public.actividades a where a.id::text = new.actividad;
  v_previous := case v_name
    when 'label' then 'stage'
    when 'scan' then 'label'
    when 'load' then 'scan'
    else null
  end;
  if v_previous is not null and not exists (
    select 1 from public.actividades_realizadas r
    join public.actividades a on a.id::text = r.actividad
    join public.shipping_activity_labels c on c.actividad_id = r.id
    where r.idx = new.idx and pg_catalog.lower(a.nombre) = v_previous
      and r.estado = 'finalizada' and c.etiqueta_fin is not null
      and public.shipping_products_equal(r.productos, new.productos)
  ) then
    raise exception 'Complete % antes de % para el mismo IDX y las mismas cajas',
      pg_catalog.upper(v_previous), pg_catalog.upper(v_name);
  end if;
  return new;
end $$;

create trigger shipping_guard_activity_order
  before insert on public.actividades_realizadas
  for each row execute function public.shipping_guard_activity_order();

revoke all on function public.shipping_guard_activity_order() from public;
