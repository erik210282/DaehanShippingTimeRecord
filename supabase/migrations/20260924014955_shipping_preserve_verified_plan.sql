-- After a captured start, keep the IDX, phase, product and box totals stable.
-- Supervisor instructions and operator comments may still be edited.
create function public.shipping_guard_activity_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.shipping_activity_labels c
             where c.actividad_id = old.id)
     and (new.idx is distinct from old.idx
          or new.actividad is distinct from old.actividad
          or new.tarea_id is distinct from old.tarea_id
          or new.productos is distinct from old.productos) then
    raise exception 'No puede cambiar IDX, actividad, tarea o cajas después de capturar la etiqueta';
  end if;
  return new;
end $$;

create trigger shipping_guard_activity_identity
  before update of idx, actividad, tarea_id, productos on public.actividades_realizadas
  for each row execute function public.shipping_guard_activity_identity();

create function public.shipping_guard_task_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.actividades_realizadas a
    join public.shipping_activity_labels c on c.actividad_id = a.id
    where a.tarea_id = old.id::text
  ) and (new.idx is distinct from old.idx
           or new.actividad is distinct from old.actividad
           or new.productos is distinct from old.productos) then
    raise exception 'No puede cambiar IDX, actividad o cajas de una tarea iniciada';
  end if;
  return new;
end $$;

create trigger shipping_guard_task_identity
  before update of idx, actividad, productos on public.tareas_pendientes
  for each row execute function public.shipping_guard_task_identity();

revoke all on function public.shipping_guard_activity_identity() from public;
revoke all on function public.shipping_guard_task_identity() from public;
