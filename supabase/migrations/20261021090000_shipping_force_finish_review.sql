create table rls_internal.shipping_forced_closures (
 activity_id uuid primary key references public.actividades_realizadas(id) on delete cascade,
 task_id uuid references public.tareas_pendientes(id) on delete set null,
 actor uuid not null, reason text not null, forced_at timestamptz not null default now(),
 closing_tx bigint not null, reviewed_at timestamptz, reviewed_by uuid
);
revoke all on rls_internal.shipping_forced_closures from public, anon, authenticated;
alter table public.actividades_realizadas add column force_review_pending boolean not null default false;
create function rls_internal.shipping_can_force_finish() returns boolean language sql stable security definer set search_path='' as $$
 select public.inventory_access('shipping') and exists(select 1 from public.global_department_memberships
 where user_id=auth.uid() and department='shipping' and active and role in ('lider','supervisor'));
$$;
create function public.shipping_can_force_finish() returns boolean language sql stable set search_path='' as $$select rls_internal.shipping_can_force_finish()$$;
revoke all on function rls_internal.shipping_can_force_finish() from public,anon;
revoke all on function public.shipping_can_force_finish() from public,anon;
grant execute on function rls_internal.shipping_can_force_finish(), public.shipping_can_force_finish() to authenticated;
create function rls_internal.shipping_force_context(p_activity uuid default null,p_task uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select rls_internal.shipping_can_force_finish() and exists(select 1 from rls_internal.shipping_forced_closures f
 where (f.activity_id=p_activity or f.task_id=p_task) and f.actor=auth.uid() and f.closing_tx=txid_current());
$$;
revoke all on function rls_internal.shipping_force_context(uuid,uuid) from public,anon,authenticated;
create function public.shipping_guard_force_review() returns trigger language plpgsql set search_path='' as $$
begin
 if ((tg_op='INSERT' and new.force_review_pending) or
 (tg_op='UPDATE' and new.force_review_pending is distinct from old.force_review_pending))
 and current_user not in ('postgres','supabase_admin') then raise exception 'El estado de revisión solo se actualiza mediante Shipping'; end if;
 return new;
end $$;
create trigger shipping_guard_force_review before insert or update on public.actividades_realizadas for each row execute function public.shipping_guard_force_review();
alter table public.shipping_supervisor_actions drop constraint shipping_supervisor_actions_action_check;
alter table public.shipping_supervisor_actions add constraint shipping_supervisor_actions_action_check check(action in('start','finish','edit_first_label','force_finish','review_force_finish'));
CREATE OR REPLACE FUNCTION public.shipping_guard_activity_finish()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_capture public.shipping_activity_labels%rowtype;
  v_task public.tareas_pendientes%rowtype;
begin
  if rls_internal.shipping_force_context(new.id,null) then return new; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.shipping_guard_task_finish()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if rls_internal.shipping_force_context(null,new.id) then return new; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.shipping_guard_legacy_load_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if rls_internal.shipping_force_context(new.id,null) then return new; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.shipping_guard_finish_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_position integer;
begin
  if rls_internal.shipping_force_context(new.id,null) then return new; end if;
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
end $function$
;
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
    pausa_total = v_pause, "updatedAt" = now(), force_review_pending=true
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
create function public.shipping_force_finish_task(p_tarea uuid,p_reason text) returns uuid language sql set search_path='' as $$select rls_internal.shipping_force_finish_task($1,$2)$$;
revoke all on function rls_internal.shipping_force_finish_task(uuid,text),public.shipping_force_finish_task(uuid,text) from public,anon;
grant execute on function rls_internal.shipping_force_finish_task(uuid,text),public.shipping_force_finish_task(uuid,text) to authenticated;
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
       and (lower(k.nombre)<>'load' or exists(
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
end
$function$
;
CREATE OR REPLACE FUNCTION public.shipping_summary_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_idx text DEFAULT ''::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with keys as materialized (
  select distinct a.idx from public.actividades_realizadas a
  where a.estado = 'finalizada' and a.idx is not null and a.idx <> ''
   and (coalesce(p_idx,'') = '' or strpos(lower(a.idx),lower(p_idx)) > 0)
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 ), bounds as (
  select count(*) as total, greatest(1,least(coalesce(p_page,1),
   greatest(1,ceil(count(*)::numeric / greatest(1,least(coalesce(p_page_size,25),100)))::integer))) as page,
   greatest(1,least(coalesce(p_page_size,25),100)) as size from keys
 ), selected as (
  select idx from keys order by idx collate public.shipping_idx_natural desc, idx desc
  limit (select size from bounds) offset (select (page-1)*size from bounds)
 ), rows as (
  select a.id,a.estado,a.force_review_pending,a.hora_inicio,a.productos,a.operadores,a.notas,a.duracion,a.idx,
   a."createdAt",a.actividad,a.pausa_total,a.comentario_actividad,
   a.trailer,a.puerta,a.trailer_fin,a.puerta_fin,a.etiqueta_inicio_manual,a.etiqueta_fin_manual
  from public.actividades_realizadas a join selected s using(idx)
  where a.estado = 'finalizada'
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 )
 select jsonb_build_object('total',b.total,'page',b.page,
  'activities',coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt",r.id) from rows r),'[]'::jsonb),
  'captures',coalesce((select jsonb_object_agg(c.actividad_id,jsonb_build_object(
   'etiqueta_inicio',c.etiqueta_inicio,'etiqueta_fin',c.etiqueta_fin,
   'trailer',c.trailer,'puerta',c.puerta,'trailer_fin',c.trailer_fin,'puerta_fin',c.puerta_fin))
   from public.shipping_activity_labels c join rows r on r.id=c.actividad_id),'{}'::jsonb))
 from bounds b;
$function$
;

alter table rls_internal.shipping_forced_closures add column review_tx bigint;
alter table public.actividades_realizadas add column force_closed_at timestamptz;
create or replace function public.shipping_guard_force_review() returns trigger language plpgsql set search_path='' as $$
begin
 if ((tg_op='INSERT' and (new.force_review_pending or new.force_closed_at is not null)) or
 (tg_op='UPDATE' and (new.force_review_pending is distinct from old.force_review_pending or new.force_closed_at is distinct from old.force_closed_at)))
 and current_user not in ('postgres','supabase_admin') then raise exception 'El estado de revisión solo se actualiza mediante Shipping'; end if;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.shipping_guard_activity_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.force_review_pending and rls_internal.shipping_can_force_finish()
     and new.idx is not distinct from old.idx and new.actividad is not distinct from old.actividad
     and new.tarea_id is not distinct from old.tarea_id
     and exists(select 1 from rls_internal.shipping_forced_closures where activity_id=old.id and review_tx=txid_current())
  then return new; end if;
  if exists (select 1 from public.shipping_activity_labels c
             where c.actividad_id = old.id)
     and (new.idx is distinct from old.idx
          or new.actividad is distinct from old.actividad
          or new.tarea_id is distinct from old.tarea_id
          or new.productos is distinct from old.productos) then
    raise exception 'No puede cambiar IDX, actividad, tarea o cajas después de capturar la etiqueta';
  end if;
  return new;
end $function$
;
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
end
$function$
;
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
CREATE OR REPLACE FUNCTION public.shipping_summary_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_idx text DEFAULT ''::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with keys as materialized (
  select distinct a.idx from public.actividades_realizadas a
  where a.estado = 'finalizada' and a.idx is not null and a.idx <> ''
   and (coalesce(p_idx,'') = '' or strpos(lower(a.idx),lower(p_idx)) > 0)
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 ), bounds as (
  select count(*) as total, greatest(1,least(coalesce(p_page,1),
   greatest(1,ceil(count(*)::numeric / greatest(1,least(coalesce(p_page_size,25),100)))::integer))) as page,
   greatest(1,least(coalesce(p_page_size,25),100)) as size from keys
 ), selected as (
  select idx from keys order by idx collate public.shipping_idx_natural desc, idx desc
  limit (select size from bounds) offset (select (page-1)*size from bounds)
 ), rows as (
  select a.id,a.estado,a.force_review_pending,a.force_closed_at,a.hora_inicio,a.productos,a.operadores,a.notas,a.duracion,a.idx,
   a."createdAt",a.actividad,a.pausa_total,a.comentario_actividad,
   a.trailer,a.puerta,a.trailer_fin,a.puerta_fin,a.etiqueta_inicio_manual,a.etiqueta_fin_manual
  from public.actividades_realizadas a join selected s using(idx)
  where a.estado = 'finalizada'
   and (p_from is null or a.hora_inicio >= p_from)
   and (p_to is null or a.hora_inicio <= p_to)
 )
 select jsonb_build_object('total',b.total,'page',b.page,
  'activities',coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt",r.id) from rows r),'[]'::jsonb),
  'captures',coalesce((select jsonb_object_agg(c.actividad_id,jsonb_build_object(
   'etiqueta_inicio',c.etiqueta_inicio,'etiqueta_fin',c.etiqueta_fin,
   'trailer',c.trailer,'puerta',c.puerta,'trailer_fin',c.trailer_fin,'puerta_fin',c.puerta_fin))
   from public.shipping_activity_labels c join rows r on r.id=c.actividad_id),'{}'::jsonb))
 from bounds b;
$function$
;
