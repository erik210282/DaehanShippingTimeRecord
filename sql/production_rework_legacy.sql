CREATE OR REPLACE FUNCTION rls_internal.inventory_quality_resolve(p_hold uuid, p_release boolean, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hold public.inventory_quality_holds%rowtype; v_remaining numeric;
begin
  select * into v_hold from public.inventory_quality_holds where id=p_hold for update;
  if not found or v_hold.status<>'held' or not public.inventory_access('quality',true)
    or p_release is null then raise exception 'Retención no disponible para revisión'; end if;
  if exists(select 1 from public.production_rework_reports where hold_id=p_hold and status='pending') then raise exception 'rw_pending_review';end if;
  v_remaining:=v_hold.quantity-v_hold.released_quantity-v_hold.rejected_quantity;
  if v_remaining<=0 then raise exception 'rw_unavailable';end if;
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
    values(v_hold.item_id,'HOLD',-v_remaining,
      case when p_release then 'QUALITY_RELEASE' else 'QUALITY_REJECT' end,
      'hold-close:'||p_hold,coalesce(p_note,''),v_hold.lot,auth.uid());
  if p_release then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by)
      values(v_hold.item_id,v_hold.source_area,v_remaining,'QUALITY_RELEASE',
        'hold-release:'||p_hold,coalesce(p_note,''),v_hold.lot,auth.uid());
  end if;
  update public.inventory_quality_holds set released_quantity=released_quantity+case when p_release then v_remaining else 0 end,rejected_quantity=rejected_quantity+case when p_release then 0 else v_remaining end,version=version+1,status=case when (p_release and rejected_quantity>0) or (not p_release and released_quantity>0) then 'resolved' when p_release then 'released' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=p_hold;
  return p_hold;
end $function$;

