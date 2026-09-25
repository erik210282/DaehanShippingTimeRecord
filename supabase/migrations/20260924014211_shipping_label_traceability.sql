-- Shipping rollout is additive: tasks already in progress keep their old path.
-- New label plans are opt-in, and the mobile client uses the RPCs below for them.
alter table public.tareas_pendientes
  add column if not exists instrucciones_supervisor text;
alter table public.actividades_realizadas
  add column if not exists instrucciones_supervisor text,
  add column if not exists comentario_actividad text;

create table if not exists public.shipping_lines (
  id uuid primary key default gen_random_uuid(),
  idx text not null,
  idx_line text not null,
  producto uuid not null references public.productos(id),
  cantidad_cajas integer not null check (cantidad_cajas > 0 and cantidad_cajas <= 10000),
  primera_etiqueta text not null,
  created_at timestamptz not null default now(),
  unique (idx, idx_line),
  unique (idx, producto)
);

create table if not exists public.shipping_labels (
  codigo text primary key,
  line_id uuid not null references public.shipping_lines(id) on delete cascade,
  idx text not null,
  producto uuid not null references public.productos(id)
);
create index if not exists shipping_labels_idx_suffix4
  on public.shipping_labels (idx, right(codigo, 4));
create index if not exists shipping_labels_idx_suffix5
  on public.shipping_labels (idx, right(codigo, 5));

create table if not exists public.shipping_activity_labels (
  actividad_id uuid primary key references public.actividades_realizadas(id) on delete cascade,
  line_id uuid not null references public.shipping_lines(id),
  etiqueta_inicio text not null references public.shipping_labels(codigo),
  etiqueta_fin text references public.shipping_labels(codigo),
  trailer text,
  puerta text,
  trailer_fin text,
  puerta_fin text,
  created_at timestamptz not null default now()
);

alter table public.shipping_lines enable row level security;
alter table public.shipping_labels enable row level security;
alter table public.shipping_activity_labels enable row level security;

-- Operators need read access; only the checked RPCs write these three tables.
revoke all on public.shipping_lines, public.shipping_labels, public.shipping_activity_labels
  from anon, authenticated;
grant select on public.shipping_lines, public.shipping_labels, public.shipping_activity_labels
  to authenticated;
create policy shipping_lines_read on public.shipping_lines for select to authenticated
  using (exists (select 1 from public.operadores o
                 where o.uid = (select auth.uid()) and o.activo is true));
create policy shipping_labels_read on public.shipping_labels for select to authenticated
  using (exists (select 1 from public.operadores o
                 where o.uid = (select auth.uid()) and o.activo is true));
create policy shipping_activity_labels_read on public.shipping_activity_labels for select to authenticated
  using (exists (select 1 from public.operadores o
                 where o.uid = (select auth.uid()) and o.activo is true));

-- This helper accepts an entire scanned code, or 4/5 trailing digits only
-- when they identify exactly one label within the selected IDX.
create function public.shipping_match_label(p_idx text, p_scanned text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_code text := pg_catalog.regexp_replace(pg_catalog.upper(coalesce(p_scanned, '')), '[[:space:]]+', '', 'g');
  v_line uuid;
  v_count integer;
begin
  if not exists (select 1 from public.operadores o
                 where o.uid = auth.uid() and o.activo is true) then
    raise exception 'Usuario no autorizado';
  end if;
  if v_code = '' then raise exception 'Capture una etiqueta'; end if;
  select count(*), min(l.line_id::text)::uuid into v_count, v_line
    from public.shipping_labels l
    where l.idx = p_idx and
      (l.codigo = v_code or
       (v_code ~ '^[0-9]{4,5}$' and pg_catalog.right(l.codigo, pg_catalog.length(v_code)) = v_code));
  if v_count <> 1 then
    raise exception 'La etiqueta no corresponde de forma única al IDX %', p_idx;
  end if;
  return v_line;
end $$;

-- Each web registration creates exactly one label per expected box.
-- An existing plan can be replaced only before work starts on any of its lines.
create function public.shipping_register_plan(p_idx text, p_lines jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_line record;
  v_id uuid;
  v_code text;
  v_digits text;
  v_prefix text;
  v_first bigint;
  v_total integer := 0;
  v_i integer;
begin
  if not exists (select 1 from public.operadores o
                 where o.uid = auth.uid() and o.activo is true and o.role = 'supervisor') then
    raise exception 'Solo un supervisor puede registrar las etiquetas';
  end if;
  if nullif(pg_catalog.btrim(p_idx), '') is null
     or pg_catalog.jsonb_typeof(p_lines) <> 'array'
     or pg_catalog.jsonb_array_length(p_lines) = 0 then
    raise exception 'IDX y líneas de producto son obligatorios';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_idx));
  if exists (select 1 from public.shipping_activity_labels c
             join public.shipping_lines l on l.id = c.line_id where l.idx = p_idx)
     or exists (select 1 from public.actividades_realizadas a
                where a.idx = p_idx and a.estado in ('iniciada', 'pausada')) then
    raise exception 'No puede cambiar etiquetas después de iniciar el trabajo';
  end if;
  delete from public.shipping_lines where idx = p_idx;
  for v_line in
    select * from pg_catalog.jsonb_to_recordset(p_lines)
      as x(idx_line text, producto uuid, cantidad integer, primera_etiqueta text)
  loop
    v_code := pg_catalog.regexp_replace(pg_catalog.upper(coalesce(v_line.primera_etiqueta, '')), '[[:space:]]+', '', 'g');
    v_digits := pg_catalog.substring(v_code, '([0-9]+)$');
    v_prefix := pg_catalog.left(v_code, pg_catalog.length(v_code) - pg_catalog.length(coalesce(v_digits, '')));
    if v_line.idx_line !~ '^[0-9]{2,3}$' or v_line.producto is null
       or v_line.cantidad is null or v_line.cantidad < 1 or v_line.cantidad > 10000
       or v_digits is null
       or v_prefix !~ '^(6J|5J|1J)' or pg_catalog.length(v_digits) < 4
       or pg_catalog.length(v_digits) > 15 then
      raise exception 'Línea, cantidad o primera etiqueta inválida';
    end if;
    if not exists (select 1 from public.productos p where p.id = v_line.producto
                   and p.activo is true and nullif(pg_catalog.btrim(p.part_number), '') is not null) then
      raise exception 'El producto necesita número de parte activo';
    end if;
    v_first := v_digits::bigint;
    if pg_catalog.length((v_first + v_line.cantidad - 1)::text) > pg_catalog.length(v_digits) then
      raise exception 'La serie supera el ancho de la primera etiqueta';
    end if;
    insert into public.shipping_lines(idx, idx_line, producto, cantidad_cajas, primera_etiqueta)
      values (p_idx, v_line.idx_line, v_line.producto, v_line.cantidad, v_code)
      returning id into v_id;
    for v_i in 0 .. v_line.cantidad - 1 loop
      insert into public.shipping_labels(codigo, line_id, idx, producto)
        values (v_prefix || pg_catalog.lpad((v_first + v_i)::text, pg_catalog.length(v_digits), '0'),
                v_id, p_idx, v_line.producto);
    end loop;
    v_total := v_total + v_line.cantidad;
  end loop;
  return v_total;
end $$;

create function public.shipping_products_equal(p_a jsonb, p_b jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((
    select pg_catalog.jsonb_object_agg(producto, cantidad)
    from (select producto, sum(cantidad) as cantidad
          from pg_catalog.jsonb_to_recordset(p_a) as x(producto text, cantidad numeric)
          group by producto) s), '{}'::jsonb)
  =
  coalesce((
    select pg_catalog.jsonb_object_agg(producto, cantidad)
    from (select producto, sum(cantidad) as cantidad
          from pg_catalog.jsonb_to_recordset(p_b) as x(producto text, cantidad numeric)
          group by producto) s), '{}'::jsonb);
$$;

create function public.shipping_begin_activity(
  p_tarea uuid, p_etiqueta text, p_operadores text[],
  p_trailer text default null, p_puerta text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tarea public.tareas_pendientes%rowtype;
  v_line uuid;
  v_id uuid;
  v_name text;
begin
  if not exists (select 1 from public.operadores o
                 where o.uid = auth.uid() and o.activo is true) then
    raise exception 'Usuario no autorizado';
  end if;
  select * into v_tarea from public.tareas_pendientes where id = p_tarea for update;
  if not found then raise exception 'Tarea no encontrada'; end if;
  select a.id into v_id from public.actividades_realizadas a
    where a.tarea_id = p_tarea::text and a.estado in ('iniciada','pausada','finalizada')
    order by a."createdAt" desc limit 1;
  if v_id is not null then return v_id; end if;
  if v_tarea.estado <> 'pendiente' then raise exception 'La tarea ya no está pendiente'; end if;
  select pg_catalog.lower(a.nombre) into v_name from public.actividades a
    where a.id::text = v_tarea.actividad;
  if v_name not in ('stage','label','scan','load') then
    raise exception 'La tarea no es de Shipping';
  end if;
  if coalesce(pg_catalog.array_length(p_operadores,1),0) = 0 then
    raise exception 'Seleccione los operadores';
  end if;
  if v_name = 'load' and (nullif(pg_catalog.btrim(p_trailer),'') is null
                         or nullif(pg_catalog.btrim(p_puerta),'') is null) then
    raise exception 'Tráiler y puerta son obligatorios para LOAD';
  end if;
  if (select count(*) from public.shipping_lines where idx = v_tarea.idx)
       <> coalesce(pg_catalog.jsonb_array_length(v_tarea.productos),0)
     or exists (
       select 1 from pg_catalog.jsonb_to_recordset(v_tarea.productos)
         as p(producto text,cantidad numeric)
       left join public.shipping_lines l on l.idx = v_tarea.idx and l.producto::text = p.producto
       where l.id is null or l.cantidad_cajas <> p.cantidad
     ) then
    raise exception 'Las etiquetas deben cubrir todas las cajas y productos del IDX';
  end if;
  v_line := public.shipping_match_label(v_tarea.idx, p_etiqueta);
  if not exists (select 1 from public.shipping_lines l
                 where l.id = v_line and v_tarea.productos @>
                   pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('producto', l.producto::text))) then
    raise exception 'La etiqueta pertenece a otro producto';
  end if;
  insert into public.actividades_realizadas
    (idx, actividad, productos, operadores, hora_inicio, estado, tarea_id,
     notas, instrucciones_supervisor)
  values (v_tarea.idx, v_tarea.actividad, v_tarea.productos,
          pg_catalog.to_jsonb(p_operadores), now(), 'iniciada', p_tarea::text,
          '', coalesce(v_tarea.instrucciones_supervisor,v_tarea.notas,''))
  returning id into v_id;
  insert into public.shipping_activity_labels
    (actividad_id, line_id, etiqueta_inicio, trailer, puerta)
  values (v_id, v_line,
          (select codigo from public.shipping_labels where line_id = v_line
           and (codigo = pg_catalog.regexp_replace(pg_catalog.upper(p_etiqueta),'[[:space:]]+','','g')
             or pg_catalog.right(codigo,pg_catalog.length(pg_catalog.btrim(p_etiqueta))) = pg_catalog.btrim(p_etiqueta))
           limit 1),
          nullif(pg_catalog.btrim(p_trailer),''),
          nullif(pg_catalog.btrim(p_puerta),''));
  update public.tareas_pendientes set estado = 'iniciada', operadores = p_operadores where id = p_tarea;
  return v_id;
end $$;

create function public.shipping_end_activity(
  p_actividad uuid, p_etiqueta text, p_comentario text default '',
  p_trailer text default null, p_puerta text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_activity public.actividades_realizadas%rowtype;
  v_tarea public.tareas_pendientes%rowtype;
  v_capture public.shipping_activity_labels%rowtype;
  v_line uuid;
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
  if v_line <> v_capture.line_id then
    raise exception 'La etiqueta de cierre pertenece a otra línea del IDX';
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
        etiqueta_fin = (select codigo from public.shipping_labels l
                        where l.line_id = v_line
                          and (l.codigo = pg_catalog.regexp_replace(pg_catalog.upper(p_etiqueta),'[[:space:]]+','','g')
                            or pg_catalog.right(l.codigo,pg_catalog.length(pg_catalog.btrim(p_etiqueta))) = pg_catalog.btrim(p_etiqueta))
                        limit 1)
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

-- Planned work cannot be marked complete through the legacy direct UPDATE path.
-- The RPC writes the verified end label before advancing the activity and task.
create function public.shipping_guard_activity_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_capture public.shipping_activity_labels%rowtype;
  v_task public.tareas_pendientes%rowtype;
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.shipping_lines l where l.idx = new.idx) then
    select * into v_capture from public.shipping_activity_labels
      where actividad_id = new.id;
    if not found or v_capture.etiqueta_fin is null then
      raise exception 'La actividad necesita una etiqueta de cierre validada';
    end if;
    select * into v_task from public.tareas_pendientes where id::text = new.tarea_id;
    if not found or not public.shipping_products_equal(v_task.productos,new.productos) then
      raise exception 'Las cantidades deben coincidir con el plan completo';
    end if;
  end if;
  return new;
end $$;
create trigger shipping_guard_activity_finish
  before update of estado on public.actividades_realizadas
  for each row execute function public.shipping_guard_activity_finish();

create function public.shipping_guard_task_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'finalizada' and old.estado is distinct from 'finalizada'
     and exists (select 1 from public.shipping_lines l where l.idx = new.idx)
     and exists (select 1 from public.actividades a where a.id::text = new.actividad
                 and pg_catalog.lower(a.nombre) in ('stage','label','scan','load'))
     and not exists (
       select 1 from public.actividades_realizadas r
       join public.shipping_activity_labels c on c.actividad_id = r.id
       where r.tarea_id = new.id::text and r.estado = 'finalizada'
         and c.etiqueta_fin is not null
         and public.shipping_products_equal(new.productos,r.productos)
     ) then
    raise exception 'La tarea necesita una actividad completa y validada';
  end if;
  return new;
end $$;
create trigger shipping_guard_task_finish
  before update of estado on public.tareas_pendientes
  for each row execute function public.shipping_guard_task_finish();

-- Public functions are executable by PUBLIC unless revoked explicitly.
revoke all on function public.shipping_match_label(text,text) from public;
revoke all on function public.shipping_register_plan(text,jsonb) from public;
revoke all on function public.shipping_begin_activity(uuid,text,text[],text,text) from public;
revoke all on function public.shipping_end_activity(uuid,text,text,text,text) from public;
revoke all on function public.shipping_guard_activity_finish() from public;
revoke all on function public.shipping_guard_task_finish() from public;
grant execute on function public.shipping_match_label(text,text) to authenticated;
grant execute on function public.shipping_register_plan(text,jsonb) to authenticated;
grant execute on function public.shipping_begin_activity(uuid,text,text[],text,text) to authenticated;
grant execute on function public.shipping_end_activity(uuid,text,text,text,text) to authenticated;
