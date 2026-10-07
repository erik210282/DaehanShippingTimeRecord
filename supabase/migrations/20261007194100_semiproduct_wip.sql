CREATE OR REPLACE FUNCTION rls_internal.inventory_post_movement(p_item uuid, p_area text, p_delta numeric, p_kind text, p_note text DEFAULT ''::text, p_location text DEFAULT ''::text, p_lot text DEFAULT ''::text, p_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_category text; v_department text;
begin
  select category,responsible_department into v_category,v_department from public.inventory_items where id=p_item and active;
  if v_category is null or not public.inventory_access(case when p_area='WIP' then 'production'
    when p_area='HOLD' then 'quality' else v_department end) then raise exception 'Sin acceso al material'; end if;
  if p_delta is null or p_delta=0 or p_area not in ('RAW','WIP','PACKAGING')
     or p_kind not in ('RECEIPT','CONSUMPTION','WIP_IN','WIP_OUT')
     or (p_kind in ('RECEIPT','WIP_IN') and p_delta<0)
     or (p_kind in ('CONSUMPTION','WIP_OUT') and p_delta>0)
     or (p_area='WIP' and v_category not in ('FG','SEMI'))
     or (p_area='PACKAGING' and v_category<>'PACKAGING')
     or (p_area='RAW' and v_category<>'RAW')
     or p_date is null then raise exception 'Movimiento inválido'; end if;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,note,location,lot,effective_date,created_by)
  values(p_item,p_area,p_delta,p_kind,coalesce(p_note,''),coalesce(p_location,''),coalesce(p_lot,''),p_date,auth.uid())
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION rls_internal.inventory_submit_count(p_department text, p_area text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_line jsonb; v_item uuid; v_expected numeric;
begin
  if not public.inventory_access(p_department) or p_area not in ('RAW','WIP','FG','PACKAGING','HOLD')
     or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0
     then raise exception 'Conteo inválido'; end if;
  insert into public.inventory_counts(department,area) values(p_department,p_area) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item := (v_line->>'item_id')::uuid;
    if not exists(select 1 from public.inventory_items i where i.id=v_item and i.active
      and (p_area='WIP' and p_department='production' and i.category in ('FG','SEMI')
        or p_area='HOLD' and p_department='quality'
        or i.responsible_department=p_department
          and (p_area='FG' and i.category='FG' or p_area='RAW' and i.category='RAW'
          or p_area='PACKAGING' and i.category='PACKAGING')))
       then raise exception 'Material ajeno al departamento o área'; end if;
    select coalesce(sum(quantity_delta),0) into v_expected from public.inventory_movements
      where item_id=v_item and area=p_area;
    insert into public.inventory_count_lines(count_id,item_id,expected_quantity,physical_quantity)
      values(v_id,v_item,v_expected,(v_line->>'physical_quantity')::numeric);
  end loop;
  return v_id;
end $function$
;
