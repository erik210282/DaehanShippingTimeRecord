-- Keep a deactivation date for future historical corrections. Existing inactive
-- profiles have an unknown date; their already recorded work remains intact.
alter table public.operadores add column if not exists inactive_since timestamptz;

create or replace function public.operator_track_inactive_since()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.activo is distinct from old.activo then
    new.inactive_since := case when new.activo is true then null else now() end;
  end if;
  return new;
end $function$;

create trigger operator_track_inactive_since
before update of activo on public.operadores
for each row execute function public.operator_track_inactive_since();

-- A task assigned for current work must only include active operators.
create or replace function public.operator_guard_task_assignment()
returns trigger language plpgsql set search_path to '' as $function$
declare v_id text;
begin
  if new.estado in ('pendiente', 'iniciada', 'pausada') then
    foreach v_id in array coalesce(new.operadores, array[]::text[]) loop
      if not exists (select 1 from public.operadores o
                     where o.id::text = v_id and o.activo is true) then
        raise exception 'El operador asignado no está activo';
      end if;
    end loop;
  end if;
  return new;
end $function$;

create trigger operator_guard_task_assignment
before insert or update of operadores, estado on public.tareas_pendientes
for each row execute function public.operator_guard_task_assignment();

-- Finalized records can preserve an existing operator, or add one whose known
-- deactivation date is after the recorded work. Active work requires an active
-- operator; this also covers direct writes and the Shipping RPC.
create or replace function public.operator_guard_activity_assignment()
returns trigger language plpgsql set search_path to '' as $function$
declare v_id text;
begin
  if new.operadores is null then return new; end if;
  if pg_catalog.jsonb_typeof(new.operadores) <> 'array' then
    raise exception 'La lista de operadores no es válida';
  end if;
  for v_id in select pg_catalog.jsonb_array_elements_text(new.operadores) loop
    if exists (select 1 from public.operadores o
               where o.id::text = v_id and o.activo is true) then
      continue;
    end if;
    if tg_op = 'UPDATE' and old.estado = 'finalizada'
       and old.operadores ? v_id and new.estado = 'finalizada' then
      continue;
    end if;
    if new.estado = 'finalizada' and new.hora_fin is not null
       and exists (select 1 from public.operadores o
                   where o.id::text = v_id and o.inactive_since > new.hora_fin) then
      continue;
    end if;
    raise exception 'El operador asignado no estaba activo para este registro';
  end loop;
  return new;
end $function$;

create trigger operator_guard_activity_assignment
before insert or update of operadores on public.actividades_realizadas
for each row execute function public.operator_guard_activity_assignment();
