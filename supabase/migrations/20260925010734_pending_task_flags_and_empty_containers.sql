-- Keep task-level urgency independent from the manual priority order.
alter table public.tareas_pendientes
  add column if not exists es_urgente boolean not null default false,
  add column if not exists mismo_dia boolean not null default false;

-- Empty returnable containers remain on the task but need no shipping label.
-- A mixed task validates only product lines that actually need labels.
create or replace function public.shipping_begin_activity(
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
       <> (select count(*) from pg_catalog.jsonb_to_recordset(v_tarea.productos)
             as p(producto text)
           left join public.productos catalog on catalog.id::text = p.producto
           where coalesce(pg_catalog.lower(pg_catalog.btrim(catalog.nombre)), '')
             not in ('delivery', 'empty crates', 'empty'))
     or exists (
       select 1 from pg_catalog.jsonb_to_recordset(v_tarea.productos)
         as p(producto text,cantidad numeric)
       left join public.productos catalog on catalog.id::text = p.producto
       left join public.shipping_lines l on l.idx = v_tarea.idx and l.producto::text = p.producto
       where coalesce(pg_catalog.lower(pg_catalog.btrim(catalog.nombre)), '')
               not in ('delivery', 'empty crates', 'empty')
         and (l.id is null or l.cantidad_cajas <> p.cantidad)
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
