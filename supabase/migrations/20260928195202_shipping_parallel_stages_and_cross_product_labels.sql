-- Keep the next Shipping phase available while the previous one remains open.
-- Closing remains ordered. LOAD labels may come from different products in one IDX.
alter table public.shipping_activity_labels
  add column if not exists line_id_fin uuid references public.shipping_lines(id);
update public.shipping_activity_labels
  set line_id_fin = line_id where etiqueta_fin is not null and line_id_fin is null;

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
      and r.estado in ('iniciada', 'pausada', 'finalizada')
      and public.shipping_products_equal(r.productos, new.productos)
  ) then
    raise exception 'Inicie % antes de % para el mismo IDX y las mismas cajas',
      pg_catalog.upper(v_previous), pg_catalog.upper(v_name);
  end if;
  return new;
end $$;

-- This applies to old and planned Shipping tasks. It does not require an
-- absent historical phase, but an existing earlier open phase must finish.
create function public.shipping_guard_finish_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_position integer;
begin
  if new.estado <> 'finalizada' or old.estado = 'finalizada' then
    return new;
  end if;
  select pg_catalog.lower(a.nombre) into v_name
    from public.actividades a where a.id::text = new.actividad;
  v_position := pg_catalog.array_position(array['stage','label','scan','load'], v_name);
  if v_position is not null and exists (
    select 1 from public.actividades_realizadas r
      join public.actividades a on a.id::text = r.actividad
    where r.id <> new.id and r.idx = new.idx
      and pg_catalog.array_position(array['stage','label','scan','load'], pg_catalog.lower(a.nombre)) < v_position
      and r.estado in ('iniciada', 'pausada')
      and public.shipping_products_equal(r.productos, new.productos)
  ) then
    raise exception 'Finalice las actividades anteriores del mismo IDX antes de %', pg_catalog.upper(v_name);
  end if;
  return new;
end $$;
create trigger shipping_guard_finish_order
  before update of estado on public.actividades_realizadas
  for each row execute function public.shipping_guard_finish_order();
revoke all on function public.shipping_guard_finish_order() from public, anon, authenticated;

create or replace function public.shipping_end_activity(
  p_actividad uuid, p_etiqueta text, p_comentario text default '',
  p_trailer text default null, p_puerta text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_activity public.actividades_realizadas%rowtype;
  v_tarea public.tareas_pendientes%rowtype;
  v_capture public.shipping_activity_labels%rowtype;
  v_line uuid;
  v_code text;
  v_name text;
  v_next uuid;
  v_next_id uuid;
  v_paused_minutes numeric := 0;
begin
  if not exists (select 1 from public.operadores o
                 where o.uid = auth.uid() and o.activo is true) then
    raise exception 'Usuario no autorizado';
  end if;
  select * into v_activity from public.actividades_realizadas where id = p_actividad for update;
  if not found then raise exception 'Actividad no encontrada'; end if;
  if v_activity.estado = 'finalizada' then return v_activity.id; end if;
  if v_activity.estado <> 'iniciada' then raise exception 'Reanude la actividad antes de finalizar'; end if;
  select * into v_capture from public.shipping_activity_labels where actividad_id = p_actividad for update;
  if not found then raise exception 'La actividad no tiene captura inicial'; end if;
  select * into v_tarea from public.tareas_pendientes
    where id::text = v_activity.tarea_id for update;
  if not found then raise exception 'Tarea no encontrada'; end if;
  v_line := public.shipping_match_label(v_tarea.idx,p_etiqueta);
  if not exists (
    select 1 from public.shipping_lines l where l.id = v_line
      and l.idx = v_tarea.idx and v_tarea.productos @>
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('producto', l.producto::text))
  ) then
    raise exception 'La etiqueta de cierre pertenece a otro IDX o producto';
  end if;
  select l.codigo into v_code from public.shipping_labels l
    where l.line_id = v_line and
      (l.codigo = pg_catalog.regexp_replace(pg_catalog.upper(p_etiqueta),'[[:space:]]+','','g')
       or pg_catalog.right(l.codigo,pg_catalog.length(pg_catalog.btrim(p_etiqueta))) = pg_catalog.btrim(p_etiqueta))
    limit 1;
  if v_code is null or v_code = v_capture.etiqueta_inicio then
    raise exception 'Capture otra etiqueta válida del mismo IDX';
  end if;
  if not public.shipping_products_equal(v_tarea.productos, v_activity.productos) then
    raise exception 'Las cantidades cambiaron; LOAD no puede ser parcial';
  end if;
  select pg_catalog.lower(nombre) into v_name from public.actividades
    where id::text = v_activity.actividad;
  if v_name = 'load' then
    if nullif(v_capture.trailer,'') is null
       or nullif(v_capture.puerta,'') is null then
      raise exception 'Faltan tráiler o puerta';
    end if;
    if pg_catalog.btrim(coalesce(p_trailer,'')) <> v_capture.trailer
       or pg_catalog.btrim(coalesce(p_puerta,'')) <> v_capture.puerta then
      raise exception 'Tráiler y puerta de cierre deben coincidir con los datos de inicio';
    end if;
    if exists (
      select 1 from public.actividades p
      where pg_catalog.lower(p.nombre) in ('stage','label','scan')
        and not exists (
          select 1 from public.actividades_realizadas r
          where r.idx = v_tarea.idx and r.actividad = p.id::text
            and r.estado = 'finalizada'
            and public.shipping_products_equal(r.productos, v_tarea.productos)
        )
    ) then raise exception 'Complete STAGE, LABEL y SCAN con las mismas cajas antes de LOAD';
    end if;
  end if;
  update public.shipping_activity_labels c
    set trailer_fin = case when v_name='load' then pg_catalog.btrim(p_trailer) else null end,
        puerta_fin = case when v_name='load' then pg_catalog.btrim(p_puerta) else null end,
        line_id_fin = v_line,
        etiqueta_fin = v_code
    where c.actividad_id = p_actividad;
  -- Pair pause/resume events; the old client stores these events even when
  -- pausa_total has not yet been written on the activity.
  select coalesce(sum(greatest(0, pg_catalog.date_part('epoch',
             coalesce(next_at, now()) - paused_at) / 60)), 0)
    into v_paused_minutes
  from (
    select tipo, "timestamp" as paused_at,
           lead("timestamp") over (order by "timestamp") as next_at,
           lead(tipo) over (order by "timestamp") as next_type
    from public.pausas_historial where actividad_id = p_actividad::text
  ) h where tipo = 'pausa' and (next_type = 'reanudar' or next_at is null);
  update public.actividades_realizadas set
    estado = 'finalizada', hora_fin = now(),
    duracion = greatest(0, pg_catalog.date_part('epoch', (now()-v_activity.hora_inicio))/60-v_paused_minutes),
    pausa_total = v_paused_minutes,
    comentario_actividad = coalesce(p_comentario,''),
    "updatedAt" = now()
  where id = p_actividad;
  update public.tareas_pendientes set estado = 'finalizada' where id = v_tarea.id;
  if v_name in ('stage','label','scan') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_tarea.idx));
    select id into v_next from public.actividades
      where pg_catalog.lower(nombre) = case v_name
        when 'stage' then 'label' when 'label' then 'scan' else 'load' end limit 1;
    select t.id into v_next_id from public.tareas_pendientes t
      where t.idx = v_tarea.idx and t.actividad = v_next::text
      order by t."createdAt" desc limit 1;
    if v_next_id is null and not exists (
      select 1 from public.actividades_realizadas a
      where a.idx=v_tarea.idx and a.actividad=v_next::text
    ) then
      insert into public.tareas_pendientes
        (idx, tarea_id, actividad, productos, cantidad, notas,
         instrucciones_supervisor, estado)
      values (v_tarea.idx, v_tarea.tarea_id, v_next::text, v_tarea.productos,
              v_tarea.cantidad, v_tarea.notas,
              v_tarea.instrucciones_supervisor, 'pendiente')
      returning id into v_next_id;
    end if;
  end if;
  return v_next_id;
end $$;

create or replace function public.shipping_supervisor_edit_record(
  p_actividad uuid, p_record jsonb, p_capture jsonb default null
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_activity public.actividades_realizadas%rowtype;
  v_capture public.shipping_activity_labels%rowtype;
  v_idx text;
  v_start timestamptz;
  v_end timestamptz;
  v_duration numeric;
  v_pause numeric;
  v_label_start text;
  v_label_end text;
  v_start_line uuid;
  v_end_line uuid;
  v_trailer text;
  v_trailer_end text;
  v_dock text;
  v_dock_end text;
begin
  if not exists (
    select 1 from public.operadores o
    where o.uid = auth.uid() and o.activo is true and o.role = 'supervisor'
  ) then
    raise exception 'Solo un supervisor activo puede editar registros';
  end if;

  select * into v_activity from public.actividades_realizadas
  where id = p_actividad for update;
  if not found then raise exception 'Registro no encontrado'; end if;

  v_idx := pg_catalog.btrim(coalesce(p_record->>'idx', ''));
  if v_idx = '' or pg_catalog.jsonb_typeof(p_record->'productos') <> 'array'
      or pg_catalog.jsonb_typeof(p_record->'operadores') <> 'array'
      or nullif(p_record->>'actividad', '') is null then
    raise exception 'Faltan datos del registro';
  end if;
  v_start := (p_record->>'hora_inicio')::timestamptz;
  v_end := (p_record->>'hora_fin')::timestamptz;
  v_duration := (p_record->>'duracion')::numeric;
  v_pause := (p_record->>'pausa_total')::numeric;
  if v_start is null or v_end is null or v_start > v_end
      or v_duration is null or v_duration < 0
      or v_pause is null or v_pause < 0
      or v_duration > extract(epoch from v_end - v_start) / 60 + 0.01
      or v_pause > extract(epoch from v_end - v_start) / 60 + 0.01 then
    raise exception 'Duración, pausa u horario inválidos';
  end if;

  if p_capture is not null then
    v_label_start := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'etiqueta_inicio')), '');
    v_label_end := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'etiqueta_fin')), '');
    v_trailer := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'trailer')), '');
    v_trailer_end := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'trailer_fin')), '');
    v_dock := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'puerta')), '');
    v_dock_end := nullif(pg_catalog.upper(pg_catalog.btrim(p_capture->>'puerta_fin')), '');
    if v_dock ~* '^(DOCK[[:space:]]*)?[0-9]+$' then
      v_dock := 'DOCK ' || pg_catalog.regexp_replace(v_dock, '[^0-9]', '', 'g');
    end if;
    if v_dock_end ~* '^(DOCK[[:space:]]*)?[0-9]+$' then
      v_dock_end := 'DOCK ' || pg_catalog.regexp_replace(v_dock_end, '[^0-9]', '', 'g');
    end if;
    select * into v_capture from public.shipping_activity_labels
    where actividad_id = p_actividad for update;

    if found then
      if v_label_start is distinct from v_capture.etiqueta_inicio
          or v_idx is distinct from v_activity.idx then
        if v_label_start is not null then
          v_start_line := public.shipping_match_label(v_idx, v_label_start);
          if not exists (select 1 from public.shipping_lines l where l.id = v_start_line
             and l.idx = v_idx and (p_record->'productos') @>
               pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('producto', l.producto::text))) then
            raise exception 'La etiqueta inicial no pertenece a los productos del IDX';
          end if;
          select l.codigo into v_label_start from public.shipping_labels l
          where l.line_id = v_start_line
            and (l.codigo = v_label_start
              or pg_catalog.right(l.codigo, pg_catalog.length(v_label_start)) = v_label_start)
          limit 1;
          if v_label_start is null then raise exception 'Etiqueta inicial no encontrada'; end if;
        end if;
      end if;
      if v_label_end is distinct from v_capture.etiqueta_fin
          or v_idx is distinct from v_activity.idx then
        if v_label_end is not null then
          v_end_line := public.shipping_match_label(v_idx, v_label_end);
          if not exists (select 1 from public.shipping_lines l where l.id = v_end_line
             and l.idx = v_idx and (p_record->'productos') @>
               pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('producto', l.producto::text))) then
            raise exception 'La etiqueta de cierre no pertenece a los productos del IDX';
          end if;
          select l.codigo into v_label_end from public.shipping_labels l
          where l.line_id = v_end_line
            and (l.codigo = v_label_end
              or pg_catalog.right(l.codigo, pg_catalog.length(v_label_end)) = v_label_end)
          limit 1;
          if v_label_end is null then raise exception 'Etiqueta de cierre no encontrada'; end if;
        end if;
      end if;
      if v_label_start is not null and v_label_start = v_label_end then
        raise exception 'Las etiquetas inicial y de cierre deben ser diferentes';
      end if;
      update public.shipping_activity_labels set
        etiqueta_inicio = v_label_start, etiqueta_fin = v_label_end,
        line_id = coalesce(v_start_line, v_capture.line_id),
        line_id_fin = case when v_label_end is null then null
          else coalesce(v_end_line, v_capture.line_id_fin, v_capture.line_id) end,
        trailer = v_trailer, trailer_fin = v_trailer_end,
        puerta = v_dock, puerta_fin = v_dock_end
      where actividad_id = p_actividad;
    else
      update public.actividades_realizadas set
        etiqueta_inicio_manual = v_label_start, etiqueta_fin_manual = v_label_end,
        trailer = v_trailer, trailer_fin = v_trailer_end,
        puerta = v_dock, puerta_fin = v_dock_end
      where id = p_actividad;
    end if;
  end if;

  update public.actividades_realizadas set
    idx = v_idx, actividad = p_record->>'actividad',
    productos = p_record->'productos', operadores = p_record->'operadores',
    notas = coalesce(p_record->>'notas', ''),
    comentario_actividad = case when v_activity.comentario_actividad is not null
      then coalesce(p_record->>'notas', '') else v_activity.comentario_actividad end,
    hora_inicio = v_start, hora_fin = v_end,
    duracion = v_duration, pausa_total = v_pause,
    "updatedAt" = now()
  where id = p_actividad;
end
$function$;

-- The distinct-label invariant is independent of which product line supplied each label.
create or replace function public.shipping_guard_distinct_load_labels()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.etiqueta_fin is not null and new.etiqueta_fin = new.etiqueta_inicio
     and exists (
       select 1 from public.actividades_realizadas r
       join public.actividades a on a.id::text = r.actividad
       where r.id = new.actividad_id and pg_catalog.lower(a.nombre) = 'load'
     ) then
    raise exception 'La etiqueta de cierre debe ser otra etiqueta del mismo IDX';
  end if;
  return new;
end $$;
