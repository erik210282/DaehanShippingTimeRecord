-- New trailer receipts accept raw material and packing. Historical receipts remain actionable.
create or replace function rls_internal.receiving_start(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_stage uuid; v_others uuid[]; v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 if v_operator<>auth.uid() and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if not exists(select 1 from public.operadores o where o.uid=v_operator and o.activo and
 (exists(select 1 from public.global_department_memberships where user_id=v_operator and department='receiving' and active)
 or exists(select 1 from public.global_system_admins where user_id=v_operator))) then raise exception 'receiving_invalid_operator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_receipts where id=p_id and created_by=auth.uid()) then return p_id; end if;
 v_others:=rls_internal.receiving_operators(v_operator,p_data->'additional_operator_ids');
 select id into v_stage from public.receiving_locations where is_system_stage and active;
 if v_stage is null then raise exception 'receiving_invalid'; end if;
 if not exists(select 1 from public.receiving_suppliers where id=(p_data->>'supplier_id')::uuid and active)

 or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_receipts(id,supplier_id,manifest,trailer,dock,staging_id,po_number,created_by)
 values(p_id,(p_data->>'supplier_id')::uuid,btrim(p_data->>'manifest'),upper(btrim(p_data->>'trailer')),p_data->>'dock',v_stage,coalesce(btrim(p_data->>'po_number'),''),auth.uid());
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
 if not exists(select 1 from public.inventory_items where id=(v_line->>'item_id')::uuid and active and category in ('RAW','PACKAGING')) then raise exception 'receiving_invalid'; end if;
 insert into public.receiving_lines(receipt_id,item_id,lot,expected) values(p_id,(v_line->>'item_id')::uuid,upper(btrim(coalesce(v_line->>'lot',''))),(v_line->>'expected')::numeric);
 end loop;
 insert into public.receiving_tasks(id,receipt_id,kind,operator_id,additional_operator_ids) values(p_id,p_id,'unload',v_operator,v_others);
 return p_id;
end $$;

revoke all on function rls_internal.receiving_start(uuid,jsonb) from public,anon;
grant execute on function rls_internal.receiving_start(uuid,jsonb) to authenticated;
