CREATE OR REPLACE FUNCTION rls_internal.shipping_force_finish_task(p_tarea uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tarea public.tareas_pendientes%rowtype;
  v_activity public.actividades_realizadas%rowtype;
  v_name text;
  v_next uuid;
  v_next_id uuid;
  v_pause numeric := 0;
  v_requires_label boolean;
begin
  if not rls_internal.shipping_can_force_finish() then raise exception 'Solo líder o supervisor activo de Shipping'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Indique el motivo del cierre forzado (mínimo 5 caracteres)'; end if;
  select * into v_tarea from public.tareas_pendientes where id = p_tarea for update;
  if not found then raise exception 'Tarea no encontrada'; end if;
  select * into v_activity from public.actividades_realizadas a
    where a.tarea_id = p_tarea::text and a.estado in ('iniciada','pausada','finalizada')
    order by a."createdAt" desc limit 1 for update;
  if not found then raise exception 'La tarea no tiene actividad iniciada'; end if;
  if v_activity.estado = 'finalizada' then return v_activity.id; end if;
  select pg_catalog.lower(a.nombre) into v_name from public.actividades a
    where a.id::text = v_activity.actividad;
  insert into rls_internal.shipping_forced_closures(activity_id,task_id,actor,reason,closing_tx)
 values(v_activity.id,p_tarea,auth.uid(),btrim(p_reason),txid_current());
  if v_activity.estado='pausada' then
    insert into public.pausas_historial(actividad_id,tipo,"timestamp")
      values(v_activity.id::text,'reanudar',now());
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
    pausa_total = v_pause, "updatedAt" = now(), force_review_pending=true, force_closed_at=now()
  where id = v_activity.id;
  update public.tareas_pendientes set estado = 'finalizada' where id = p_tarea;
  insert into public.shipping_supervisor_actions(task_id, activity_id, supervisor_uid, action,details)
    values (p_tarea, v_activity.id, auth.uid(), 'force_finish',jsonb_build_object('reason',btrim(p_reason),'previous_state',v_activity.estado));
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
end $function$
;
