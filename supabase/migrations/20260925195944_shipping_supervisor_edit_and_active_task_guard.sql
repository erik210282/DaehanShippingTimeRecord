-- Existing historical duplicates are finalized. Prevent two active records
-- from being created for the same pending task by concurrent/slow requests.
create unique index if not exists actividades_realizadas_one_active_per_task
on public.actividades_realizadas (tarea_id)
where tarea_id is not null and estado in ('iniciada', 'pausada');

-- A supervisor edits the activity and its Shipping capture in one transaction.
-- Only the saved capture is used for planned labels; legacy activities retain
-- their manual columns and never become plan-verified through this editor.
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
          if public.shipping_match_label(v_idx, v_label_start) is distinct from v_capture.line_id then
            raise exception 'La etiqueta inicial no pertenece a la línea IDX';
          end if;
          select l.codigo into v_label_start from public.shipping_labels l
          where l.line_id = v_capture.line_id
            and (l.codigo = v_label_start
              or pg_catalog.right(l.codigo, pg_catalog.length(v_label_start)) = v_label_start)
          limit 1;
          if v_label_start is null then raise exception 'Etiqueta inicial no encontrada'; end if;
        end if;
      end if;
      if v_label_end is distinct from v_capture.etiqueta_fin
          or v_idx is distinct from v_activity.idx then
        if v_label_end is not null then
          if public.shipping_match_label(v_idx, v_label_end) is distinct from v_capture.line_id then
            raise exception 'La etiqueta de cierre no pertenece a la línea IDX';
          end if;
          select l.codigo into v_label_end from public.shipping_labels l
          where l.line_id = v_capture.line_id
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

revoke all on function public.shipping_supervisor_edit_record(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.shipping_supervisor_edit_record(uuid, jsonb, jsonb) to authenticated;
