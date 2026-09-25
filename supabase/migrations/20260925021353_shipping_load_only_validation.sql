-- Only LOAD requires a pair of labels; earlier phases still have to finish
-- with the same products and quantities, without scanning labels.
create or replace function public.shipping_guard_activity_order()
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
    where r.idx = new.idx and pg_catalog.lower(a.nombre) = v_previous
      and r.estado = 'finalizada'
      and public.shipping_products_equal(r.productos, new.productos)
  ) then
    raise exception 'Complete % antes de % para el mismo IDX y las mismas cajas',
      pg_catalog.upper(v_previous), pg_catalog.upper(v_name);
  end if;
  return new;
end $$;

create or replace function public.shipping_guard_activity_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_capture public.shipping_activity_labels%rowtype;
  v_task public.tareas_pendientes%rowtype;
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.shipping_lines l where l.idx = new.idx)
     and exists (select 1 from public.actividades a where a.id::text = new.actividad
                 and pg_catalog.lower(a.nombre) = 'load') then
    select * into v_capture from public.shipping_activity_labels
      where actividad_id = new.id;
    if not found or v_capture.etiqueta_fin is null then
      raise exception 'LOAD necesita una etiqueta de cierre validada';
    end if;
    select * into v_task from public.tareas_pendientes where id::text = new.tarea_id;
    if not found or not public.shipping_products_equal(v_task.productos,new.productos) then
      raise exception 'Las cantidades deben coincidir con el plan completo';
    end if;
  end if;
  return new;
end $$;

create or replace function public.shipping_guard_task_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.shipping_lines l where l.idx = new.idx)
     and exists (select 1 from public.actividades a where a.id::text = new.actividad
                 and pg_catalog.lower(a.nombre) = 'load')
     and not exists (
       select 1 from public.actividades_realizadas r
       join public.shipping_activity_labels c on c.actividad_id = r.id
       where r.tarea_id = new.id::text and r.estado = 'finalizada'
         and c.etiqueta_fin is not null
         and public.shipping_products_equal(new.productos,r.productos)
     ) then
    raise exception 'LOAD necesita una actividad completa y validada';
  end if;
  return new;
end $$;

-- The planned LOAD closing label has to be another label on the same line.
-- The existing shipping_match_label RPC resolves exactly one full code from
-- four trailing digits and rejects ambiguous matches across the IDX.
create function public.shipping_guard_distinct_load_labels()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.etiqueta_fin is not null and new.etiqueta_fin = old.etiqueta_inicio
     and exists (
       select 1 from public.actividades_realizadas r
       join public.actividades a on a.id::text = r.actividad
       where r.id = new.actividad_id and pg_catalog.lower(a.nombre) = 'load'
     ) then
    raise exception 'La etiqueta de cierre debe ser otra etiqueta de la misma línea IDX';
  end if;
  return new;
end $$;
create trigger shipping_guard_distinct_load_labels
  before update of etiqueta_fin on public.shipping_activity_labels
  for each row execute function public.shipping_guard_distinct_load_labels();
revoke all on function public.shipping_guard_distinct_load_labels() from public;

-- Unplanned old loads retain their manual status; match trailer and door on
-- closing whenever the values were actually captured at start.
alter table public.actividades_realizadas
  add column if not exists trailer_fin text,
  add column if not exists puerta_fin text;

create function public.shipping_guard_legacy_load_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.actividades a
                 where a.id::text = old.actividad and pg_catalog.lower(a.nombre) = 'load')
     and not exists (select 1 from public.shipping_lines l where l.idx = old.idx) then
    if old.trailer is not null or old.puerta is not null then
      if pg_catalog.btrim(coalesce(new.trailer_fin,'')) <> pg_catalog.btrim(coalesce(old.trailer,''))
         or pg_catalog.btrim(coalesce(new.puerta_fin,'')) <> pg_catalog.btrim(coalesce(old.puerta,''))
         or nullif(pg_catalog.btrim(new.trailer_fin),'') is null
         or nullif(pg_catalog.btrim(new.puerta_fin),'') is null then
        raise exception 'Tráiler y puerta de cierre deben coincidir con los datos de inicio';
      end if;
    end if;
    if old.etiqueta_inicio_manual is not null then
      if new.etiqueta_fin_manual !~ '^[0-9]{4}$'
         or new.etiqueta_fin_manual = old.etiqueta_inicio_manual then
        raise exception 'Capture los cuatro dígitos de otra etiqueta al cerrar LOAD';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger shipping_guard_legacy_load_close
  before update of estado on public.actividades_realizadas
  for each row execute function public.shipping_guard_legacy_load_close();
revoke all on function public.shipping_guard_legacy_load_close() from public;
