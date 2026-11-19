CREATE OR REPLACE FUNCTION rls_internal.shipping_supervisor_edit_record(p_actividad uuid, p_record jsonb, p_capture jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not rls_internal.shipping_can_force_finish() then raise exception 'Solo líder o supervisor activo de Shipping'; end if;

  select * into v_activity from public.actividades_realizadas
  where id = p_actividad for update;
  if not found then raise exception 'Registro no encontrado'; end if;

  if v_activity.force_review_pending then
    update rls_internal.shipping_forced_closures set review_tx=txid_current() where activity_id=p_actividad;
  end if;
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

    if not found and v_activity.force_review_pending and exists(select 1 from public.shipping_lines where idx=v_idx) then
      v_start_line := public.shipping_match_label(v_idx,v_label_start);
      select codigo into v_label_start from public.shipping_labels where line_id=v_start_line
        and (codigo=v_label_start or right(codigo,length(v_label_start))=v_label_start) limit 1;
      if v_label_start is null then raise exception 'Capture una etiqueta inicial válida del IDX'; end if;
      insert into public.shipping_activity_labels(actividad_id,line_id,etiqueta_inicio)
      values(p_actividad,v_start_line,v_label_start);
      select * into v_capture from public.shipping_activity_labels where actividad_id=p_actividad for update;
    end if;
    if v_capture.actividad_id is not null then
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
    instrucciones_supervisor = case when p_record ? 'instrucciones_supervisor'
      then coalesce(p_record->>'instrucciones_supervisor','') else v_activity.instrucciones_supervisor end,
    notas = coalesce(p_record->>'notas', ''),
    comentario_actividad = case when v_activity.comentario_actividad is not null
      then coalesce(p_record->>'notas', '') else v_activity.comentario_actividad end,
    hora_inicio = v_start, hora_fin = v_end,
    duracion = v_duration, pausa_total = v_pause,
    "updatedAt" = now()
  where id = p_actividad;
  if v_activity.force_review_pending then
    if exists(select 1 from public.actividades_realizadas a
       join public.actividades k on k.id::text=a.actividad
       join public.tareas_pendientes t on t.id::text=a.tarea_id
       where a.id=p_actividad and a.estado='finalizada'
       and public.shipping_products_equal(a.productos,t.productos)
       and (lower(k.nombre)<>'load' or (not exists(select 1 from public.shipping_lines where idx=a.idx)
 and a.etiqueta_inicio_manual ~ '^[0-9]{4}$' and a.etiqueta_fin_manual ~ '^[0-9]{4}$'
 and a.etiqueta_inicio_manual<>a.etiqueta_fin_manual and nullif(btrim(a.trailer),'') is not null
 and a.trailer=a.trailer_fin and a.puerta ~ '^DOCK [0-9]+$' and a.puerta=a.puerta_fin) or exists(
         select 1 from public.shipping_activity_labels c
         join public.shipping_labels s on s.codigo=c.etiqueta_inicio and s.line_id=c.line_id
         join public.shipping_labels e on e.codigo=c.etiqueta_fin and e.line_id=c.line_id_fin
         join public.shipping_lines sl on sl.id=s.line_id and sl.idx=a.idx
         join public.shipping_lines el on el.id=e.line_id and el.idx=a.idx
         where c.actividad_id=a.id and c.etiqueta_inicio<>c.etiqueta_fin
         and a.productos @> jsonb_build_array(jsonb_build_object('producto',sl.producto::text))
         and a.productos @> jsonb_build_array(jsonb_build_object('producto',el.producto::text))
         and nullif(btrim(c.trailer),'') is not null and c.trailer=c.trailer_fin
         and c.puerta ~ '^DOCK [0-9]+$' and c.puerta=c.puerta_fin))
       and not exists(select 1 from public.actividades_realizadas prior join public.actividades pk on pk.id::text=prior.actividad
          where prior.idx=a.idx and prior.id<>a.id and prior.estado in('iniciada','pausada')
          and array_position(array['stage','label','scan','load'],lower(pk.nombre)) < array_position(array['stage','label','scan','load'],lower(k.nombre))
          and public.shipping_products_equal(prior.productos,a.productos))
    ) then
      update public.actividades_realizadas set force_review_pending=false where id=p_actividad;
      update rls_internal.shipping_forced_closures set reviewed_at=now(),reviewed_by=auth.uid() where activity_id=p_actividad;
      insert into public.shipping_supervisor_actions(task_id,activity_id,supervisor_uid,action)
        values(nullif(v_activity.tarea_id,'')::uuid,p_actividad,auth.uid(),'review_force_finish');
    end if;
  end if;
  if p_record ? 'instrucciones_supervisor' then
    update public.tareas_pendientes set
      instrucciones_supervisor=coalesce(p_record->>'instrucciones_supervisor',''),
      notas=coalesce(p_record->>'instrucciones_supervisor','')
      where id::text=v_activity.tarea_id;
  end if;
end
$function$;
