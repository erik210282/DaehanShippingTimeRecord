-- Supervisor recovery actions use the same planned LOAD validation as mobile.
create table public.shipping_supervisor_actions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tareas_pendientes(id) on delete set null,
  activity_id uuid references public.actividades_realizadas(id) on delete set null,
  supervisor_uid uuid not null,
  action text not null check (action in ('start','finish','edit_first_label')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.shipping_supervisor_actions enable row level security;
revoke all on public.shipping_supervisor_actions from anon, authenticated;
grant select on public.shipping_supervisor_actions to authenticated;
create policy shipping_supervisor_actions_read on public.shipping_supervisor_actions
  for select to authenticated using (exists (
    select 1 from public.operadores o where o.uid = (select auth.uid())
      and o.activo is true and o.role = 'supervisor'
  ));

-- Empty-container-only LOAD tasks do not need a planned label capture.
create or replace function public.shipping_guard_activity_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_capture public.shipping_activity_labels%rowtype;
  v_task public.tareas_pendientes%rowtype;
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.shipping_lines l where l.idx = new.idx)
     and exists (select 1 from public.actividades a where a.id::text = new.actividad
                 and pg_catalog.lower(a.nombre) = 'load')
     and exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(new.productos, '[]'::jsonb)) p
       left join public.productos c on c.id::text = p->>'producto'
       where coalesce(pg_catalog.lower(pg_catalog.btrim(c.nombre)), '')
         not in ('delivery','empty','empty crates')
     ) then
    select * into v_capture from public.shipping_activity_labels where actividad_id = new.id;
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
     and exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(new.productos, '[]'::jsonb)) p
       left join public.productos c on c.id::text = p->>'producto'
       where coalesce(pg_catalog.lower(pg_catalog.btrim(c.nombre)), '')
         not in ('delivery','empty','empty crates')
     ) and not exists (
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

create function public.shipping_supervisor_start_task(
  p_tarea uuid, p_operadores text[], p_etiqueta text default null,
  p_trailer text default null, p_puerta text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tarea public.tareas_pendientes%rowtype;
  v_name text;
  v_id uuid;
  v_requires_label boolean;
begin
  if not exists (select 1 from public.operadores o where o.uid = auth.uid()
                 and o.activo is true and o.role = 'supervisor') then
    raise exception 'Solo un supervisor activo puede iniciar tareas';
  end if;
  select * into v_tarea from public.tareas_pendientes where id = p_tarea for update;
  if not found then raise exception 'Tarea no encontrada'; end if;
  select a.id into v_id from public.actividades_realizadas a
    where a.tarea_id = p_tarea::text and a.estado in ('iniciada','pausada','finalizada')
    order by a."createdAt" desc limit 1;
  if v_id is not null then return v_id; end if;
  if v_tarea.estado <> 'pendiente' then raise exception 'La tarea ya no está pendiente'; end if;
  if coalesce(pg_catalog.array_length(p_operadores, 1), 0) = 0
     or exists (select 1 from pg_catalog.unnest(p_operadores) id
                where id is null or not exists
                  (select 1 from public.operadores o where o.id::text = id and o.activo is true)) then
    raise exception 'Seleccione al menos un operador activo';
  end if;
  select pg_catalog.lower(a.nombre) into v_name from public.actividades a
    where a.id::text = v_tarea.actividad;
  if v_name is null then raise exception 'Actividad no encontrada'; end if;
  select exists (
    select 1 from pg_catalog.jsonb_array_elements(coalesce(v_tarea.productos, '[]'::jsonb)) p
    left join public.productos c on c.id::text = p->>'producto'
    where coalesce(pg_catalog.lower(pg_catalog.btrim(c.nombre)), '')
      not in ('delivery','empty','empty crates')
  ) into v_requires_label;
  if v_name = 'load' then
    if nullif(pg_catalog.btrim(p_trailer), '') is null
       or coalesce(pg_catalog.upper(pg_catalog.btrim(p_puerta)), '') !~ '^DOCK [0-9]+$' then
      raise exception 'Capture tráiler y bahía de carga (DOCK número)';
    end if;
    if v_requires_label and coalesce(p_etiqueta, '') !~ '^[0-9]{4}$' then
      raise exception 'Capture los últimos cuatro dígitos de una etiqueta';
    end if;
  end if;
  if v_name = 'load' and v_requires_label and exists
     (select 1 from public.shipping_lines l where l.idx = v_tarea.idx) then
    v_id := public.shipping_begin_activity(p_tarea, p_etiqueta, p_operadores,
      pg_catalog.upper(pg_catalog.btrim(p_trailer)), pg_catalog.upper(pg_catalog.btrim(p_puerta)));
    insert into public.shipping_supervisor_actions(task_id, activity_id, supervisor_uid, action)
      values (p_tarea, v_id, auth.uid(), 'start');
    return v_id;
  end if;
  insert into public.actividades_realizadas
    (idx, actividad, productos, operadores, hora_inicio, estado, tarea_id,
     notas, instrucciones_supervisor, trailer, puerta, etiqueta_inicio_manual)
  values (v_tarea.idx, v_tarea.actividad, v_tarea.productos,
          pg_catalog.to_jsonb(p_operadores), now(), 'iniciada', p_tarea::text,
          '', coalesce(v_tarea.instrucciones_supervisor, v_tarea.notas, ''),
          case when v_name = 'load' then pg_catalog.upper(pg_catalog.btrim(p_trailer)) end,
          case when v_name = 'load' then pg_catalog.upper(pg_catalog.btrim(p_puerta)) end,
          case when v_name = 'load' and v_requires_label then p_etiqueta end)
  returning id into v_id;
  update public.tareas_pendientes set estado = 'iniciada', operadores = p_operadores
    where id = p_tarea;
  insert into public.shipping_supervisor_actions(task_id, activity_id, supervisor_uid, action)
    values (p_tarea, v_id, auth.uid(), 'start');
  return v_id;
end $$;

create function public.shipping_supervisor_finish_task(
  p_tarea uuid, p_etiqueta text default null,
  p_trailer text default null, p_puerta text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tarea public.tareas_pendientes%rowtype;
  v_activity public.actividades_realizadas%rowtype;
  v_name text;
  v_next uuid;
  v_next_id uuid;
  v_pause numeric := 0;
  v_requires_label boolean;
  v_trailer text := nullif(pg_catalog.upper(pg_catalog.btrim(p_trailer)), '');
  v_puerta text := nullif(pg_catalog.upper(pg_catalog.btrim(p_puerta)), '');
begin
  if not exists (select 1 from public.operadores o where o.uid = auth.uid()
                 and o.activo is true and o.role = 'supervisor') then
    raise exception 'Solo un supervisor activo puede finalizar tareas';
  end if;
  select * into v_tarea from public.tareas_pendientes where id = p_tarea for update;
  if not found then raise exception 'Tarea no encontrada'; end if;
  select * into v_activity from public.actividades_realizadas a
    where a.tarea_id = p_tarea::text and a.estado in ('iniciada','pausada','finalizada')
    order by a."createdAt" desc limit 1 for update;
  if not found then raise exception 'La tarea no tiene actividad iniciada'; end if;
  if v_activity.estado = 'finalizada' then return v_activity.id; end if;
  select pg_catalog.lower(a.nombre) into v_name from public.actividades a
    where a.id::text = v_activity.actividad;
  select exists (
    select 1 from pg_catalog.jsonb_array_elements(coalesce(v_tarea.productos, '[]'::jsonb)) p
    left join public.productos c on c.id::text = p->>'producto'
    where coalesce(pg_catalog.lower(pg_catalog.btrim(c.nombre)), '')
      not in ('delivery','empty','empty crates')
  ) into v_requires_label;
  if v_name = 'load' then
    if v_trailer is null or coalesce(v_puerta, '') !~ '^DOCK [0-9]+$' then
      raise exception 'Capture tráiler y bahía de carga (DOCK número)';
    end if;
    if v_requires_label and coalesce(p_etiqueta, '') !~ '^[0-9]{4}$' then
      raise exception 'Capture los últimos cuatro dígitos de otra etiqueta';
    end if;
  end if;
  if v_activity.estado = 'pausada' then
    insert into public.pausas_historial(actividad_id, tipo, "timestamp")
      values (v_activity.id::text, 'reanudar', now());
    update public.actividades_realizadas set estado = 'iniciada' where id = v_activity.id;
  end if;
  if v_name = 'load' and v_requires_label and exists
     (select 1 from public.shipping_activity_labels c where c.actividad_id = v_activity.id) then
    perform public.shipping_end_activity(v_activity.id, p_etiqueta, '', v_trailer, v_puerta);
    insert into public.shipping_supervisor_actions(task_id, activity_id, supervisor_uid, action)
      values (p_tarea, v_activity.id, auth.uid(), 'finish');
    return v_activity.id;
  end if;
  if v_name = 'load' and (
       (v_activity.trailer is not null and v_trailer is distinct from v_activity.trailer)
       or (v_activity.puerta is not null and v_puerta is distinct from v_activity.puerta)
       or (v_activity.etiqueta_inicio_manual is not null and
           p_etiqueta = v_activity.etiqueta_inicio_manual)) then
    raise exception 'Bahía y tráiler deben coincidir; use otra etiqueta de la carga';
  end if;
  select coalesce(sum(greatest(0, pg_catalog.date_part('epoch',
         coalesce(next_at, now()) - paused_at) / 60)), 0) into v_pause
  from (
    select tipo, "timestamp" as paused_at,
      lead("timestamp") over (order by "timestamp") as next_at,
      lead(tipo) over (order by "timestamp") as next_type
    from public.pausas_historial where actividad_id = v_activity.id::text
  ) h where tipo = 'pausa' and (next_type = 'reanudar' or next_at is null);
  update public.actividades_realizadas set
    estado = 'finalizada', hora_fin = now(),
    duracion = greatest(0, pg_catalog.date_part('epoch', now() - v_activity.hora_inicio)/60 - v_pause),
    pausa_total = v_pause, "updatedAt" = now(),
    trailer_fin = case when v_name = 'load' then v_trailer end,
    puerta_fin = case when v_name = 'load' then v_puerta end,
    etiqueta_fin_manual = case when v_name = 'load' and v_requires_label then p_etiqueta end
  where id = v_activity.id;
  update public.tareas_pendientes set estado = 'finalizada' where id = p_tarea;
  insert into public.shipping_supervisor_actions(task_id, activity_id, supervisor_uid, action)
    values (p_tarea, v_activity.id, auth.uid(), 'finish');
  if v_name in ('stage','label','scan') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tarea.idx));
    select id into v_next from public.actividades
      where pg_catalog.lower(nombre) = case v_name
        when 'stage' then 'label' when 'label' then 'scan' else 'load' end limit 1;
    if v_next is not null then
      select t.id into v_next_id from public.tareas_pendientes t
        where t.idx = v_tarea.idx and t.actividad = v_next::text
        order by t."createdAt" desc limit 1;
      if v_next_id is null and not exists (
        select 1 from public.actividades_realizadas a
          where a.idx = v_tarea.idx and a.actividad = v_next::text
      ) then
        insert into public.tareas_pendientes
          (idx, tarea_id, actividad, productos, cantidad, notas,
           instrucciones_supervisor, es_urgente, mismo_dia, estado)
        values (v_tarea.idx, v_tarea.tarea_id, v_next::text, v_tarea.productos,
                v_tarea.cantidad, v_tarea.notas, v_tarea.instrucciones_supervisor,
                v_tarea.es_urgente, v_tarea.mismo_dia, 'pendiente')
        returning id into v_next_id;
      end if;
    end if;
  end if;
  return v_activity.id;
end $$;

-- Correct the planned first label before LOAD has captured any label from this line.
create function public.shipping_supervisor_change_first_label(p_line uuid, p_first text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_line public.shipping_lines%rowtype;
  v_task_id uuid;
  v_code text := pg_catalog.regexp_replace(pg_catalog.upper(coalesce(p_first, '')), '[[:space:]]+', '', 'g');
  v_digits text;
  v_prefix text;
  v_first numeric;
  v_i integer;
begin
  if not exists (select 1 from public.operadores o where o.uid = auth.uid()
                 and o.activo is true and o.role = 'supervisor') then
    raise exception 'Solo un supervisor activo puede corregir etiquetas';
  end if;
  select * into v_line from public.shipping_lines where id = p_line for update;
  if not found then raise exception 'Línea IDX no encontrada'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_line.idx));
  if exists (select 1 from public.shipping_activity_labels c where c.line_id = v_line.id) then
    raise exception 'La carga ya inició; corrija la captura histórica en Registros';
  end if;
  if v_line.primera_etiqueta = v_code then return v_code; end if;
  v_digits := pg_catalog.substring(v_code, '([0-9]+)$');
  v_prefix := pg_catalog.left(v_code, pg_catalog.length(v_code) - pg_catalog.length(coalesce(v_digits, '')));
  if v_prefix !~ '^(6J|5J|1J)' or v_digits is null
     or pg_catalog.length(v_digits) < 4 or pg_catalog.length(v_digits) > 64 then
    raise exception 'La primera etiqueta debe iniciar con 6J/5J/1J y terminar con números';
  end if;
  v_first := v_digits::numeric;
  if pg_catalog.length((v_first + v_line.cantidad_cajas - 1)::text) > pg_catalog.length(v_digits) then
    raise exception 'La serie supera el ancho de la primera etiqueta';
  end if;
  delete from public.shipping_labels where line_id = v_line.id;
  update public.shipping_lines set primera_etiqueta = v_code where id = v_line.id;
  for v_i in 0 .. v_line.cantidad_cajas - 1 loop
    insert into public.shipping_labels(codigo, line_id, idx, producto)
      values (v_prefix || pg_catalog.lpad((v_first + v_i)::text, pg_catalog.length(v_digits), '0'),
              v_line.id, v_line.idx, v_line.producto);
  end loop;
  update public.tareas_pendientes t set productos = (
    select pg_catalog.jsonb_agg(
      case when p.value->>'producto' = v_line.producto::text
        then pg_catalog.jsonb_set(p.value, '{primera_etiqueta}', pg_catalog.to_jsonb(v_code), true)
        else p.value end order by p.ordinality)
    from pg_catalog.jsonb_array_elements(t.productos) with ordinality as p(value, ordinality)
  ) where t.idx = v_line.idx and t.productos @>
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('producto', v_line.producto::text));
  select t.id into v_task_id from public.tareas_pendientes t
    join public.actividades a on a.id::text = t.actividad
    where t.idx = v_line.idx and pg_catalog.lower(a.nombre) = 'load'
    order by t."createdAt" desc limit 1;
  insert into public.shipping_supervisor_actions(task_id, supervisor_uid, action, details)
    values (v_task_id, auth.uid(), 'edit_first_label',
      pg_catalog.jsonb_build_object('idx', v_line.idx, 'line_id', p_line,
        'previous', v_line.primera_etiqueta, 'updated', v_code));
  return v_code;
end $$;

revoke all on function public.shipping_supervisor_start_task(uuid,text[],text,text,text) from public, anon;
revoke all on function public.shipping_supervisor_finish_task(uuid,text,text,text) from public, anon;
revoke all on function public.shipping_supervisor_change_first_label(uuid,text) from public, anon;
grant execute on function public.shipping_supervisor_start_task(uuid,text[],text,text,text) to authenticated;
grant execute on function public.shipping_supervisor_finish_task(uuid,text,text,text) to authenticated;
grant execute on function public.shipping_supervisor_change_first_label(uuid,text) to authenticated;
