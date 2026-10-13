CREATE OR REPLACE FUNCTION rls_internal.inventory_quality_hold(p_item uuid, p_area text, p_quantity numeric, p_reason text, p_lot text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if not rls_internal.role_activity_access('quality','quality') then raise exception 'ra_denied';end if;
  if not public.inventory_access('quality') or p_area not in ('RAW','WIP','FG','PACKAGING')
    or p_quantity is null or p_quantity<=0 or nullif(btrim(p_reason),'') is null
    or not exists(select 1 from public.inventory_items where id=p_item and active
      and (category=p_area or p_area='WIP' and category in ('FG','SEMI')))
    then raise exception 'Retención inválida'; end if;
  insert into public.inventory_quality_holds(item_id,source_area,quantity,reason,lot,created_by)
    values(p_item,p_area,p_quantity,p_reason,coalesce(p_lot,''),auth.uid()) returning id into v_id;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
    values(p_item,p_area,-p_quantity,'QUALITY_HOLD','hold-source:'||v_id,p_reason,coalesce(p_lot,''),auth.uid()),
      (p_item,'HOLD',p_quantity,'QUALITY_HOLD','hold:'||v_id,p_reason,coalesce(p_lot,''),auth.uid());
  return v_id;
end $function$;

