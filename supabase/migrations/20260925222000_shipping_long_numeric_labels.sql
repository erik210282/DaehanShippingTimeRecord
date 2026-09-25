-- Shipping labels can have a long numeric identifier before their serial digits.
-- Preserve the full identifier while incrementing the numeric tail with exact precision.
create or replace function public.shipping_register_plan(p_idx text, p_lines jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_line record;
  v_id uuid;
  v_code text;
  v_digits text;
  v_prefix text;
  v_first numeric;
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
       or pg_catalog.length(v_digits) > 64 then
      raise exception 'Línea, cantidad o primera etiqueta inválida';
    end if;
    if not exists (select 1 from public.productos p where p.id = v_line.producto
                   and p.activo is true and nullif(pg_catalog.btrim(p.part_number), '') is not null) then
      raise exception 'El producto necesita número de parte activo';
    end if;
    v_first := v_digits::numeric;
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
