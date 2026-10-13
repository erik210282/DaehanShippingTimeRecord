CREATE OR REPLACE FUNCTION rls_internal.inventory_review_count(p_count uuid, p_approve boolean, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count public.inventory_counts%rowtype; v_line record;
begin
 if not rls_internal.role_activity_access('inventory','counts') then raise exception 'ra_denied';end if;
  select * into v_count from public.inventory_counts where id=p_count for update;
  if not found or v_count.status<>'submitted'
     or not public.inventory_access(v_count.department,true) then raise exception 'Conteo no disponible para aprobación'; end if;
  if p_approve is null then raise exception 'Indique aprobar o rechazar'; end if;
  if p_approve then
    for v_line in select * from public.inventory_count_lines where count_id=p_count loop
      if v_line.physical_quantity<>v_line.expected_quantity then
        insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
          values(v_line.item_id,v_count.area,v_line.physical_quantity-v_line.expected_quantity,
            case when not exists(select 1 from public.inventory_movements m where m.item_id=v_line.item_id and m.area=v_count.area)
              then 'OPENING' else 'COUNT_ADJUSTMENT' end,
            'count:'||p_count||':'||v_line.item_id,coalesce(p_note,''),current_date,auth.uid());
      end if;
    end loop;
  end if;
  update public.inventory_counts set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=p_count;
  return p_count;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.inventory_submit_counts(p_groups jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g jsonb; ids uuid[]:='{}'; cid uuid;
begin
 if not rls_internal.role_activity_access('inventory','counts') then raise exception 'ra_denied';end if;
 if auth.uid() is null or jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 25 then raise exception 'inv_review_quantities';end if;
 for g in select value from jsonb_array_elements(p_groups) order by value->>'department',value->>'area' loop
  cid:=rls_internal.inventory_submit_count(g->>'department',g->>'area',g->'lines');
  ids:=array_append(ids,cid);
 end loop;
 return ids;
end $function$;

