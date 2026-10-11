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
  perform pg_advisory_xact_lock(hashtextextended('count:'||p_department||':'||p_area,0));
  if exists(select 1 from public.inventory_counts where department=p_department and area=p_area and status='submitted') then raise exception 'inv_count_pending';end if;
  insert into public.inventory_counts(department,area) values(p_department,p_area) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item := (v_line->>'item_id')::uuid;
    if not exists(select 1 from public.inventory_items i where i.id=v_item and i.active
      and (p_area='WIP' and p_department in ('production','inventory') and i.category in ('FG','SEMI')
        or p_area='HOLD' and p_department='quality'
        or (i.responsible_department=p_department or p_department='inventory')
          and (p_area='FG' and i.category='FG' or p_area='RAW' and i.category='RAW'
          or p_area='PACKAGING' and i.category='PACKAGING')))
       then raise exception 'Material ajeno al departamento o área'; end if;
    select coalesce(sum(quantity_delta),0) into v_expected from public.inventory_movements
      where item_id=v_item and area=p_area;
    insert into public.inventory_count_lines(count_id,item_id,expected_quantity,physical_quantity)
      values(v_id,v_item,v_expected,(v_line->>'physical_quantity')::numeric);
  end loop;
  return v_id;
end $function$;

create or replace function rls_internal.inventory_submit_counts(p_groups jsonb)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare g jsonb; ids uuid[]:='{}'; cid uuid;
begin
 if auth.uid() is null or jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 25 then raise exception 'inv_review_quantities';end if;
 for g in select value from jsonb_array_elements(p_groups) order by value->>'department',value->>'area' loop
  cid:=rls_internal.inventory_submit_count(g->>'department',g->>'area',g->'lines');
  ids:=array_append(ids,cid);
 end loop;
 return ids;
end $$;
create or replace function public.inventory_submit_counts(p_groups jsonb)
returns uuid[] language sql set search_path='' as $$ select rls_internal.inventory_submit_counts(p_groups) $$;
create or replace function rls_internal.inventory_review_counts(p_counts uuid[],p_approve boolean,p_note text default '')
returns uuid[] language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if auth.uid() is null or cardinality(p_counts) not between 1 and 100 or p_approve is null then raise exception 'inv_review_quantities';end if;
 for cid in select distinct x from unnest(p_counts) x order by x loop
  perform rls_internal.inventory_review_count(cid,p_approve,p_note);
 end loop;
 return p_counts;
end $$;
create or replace function public.inventory_review_counts(p_counts uuid[],p_approve boolean,p_note text default '')
returns uuid[] language sql set search_path='' as $$ select rls_internal.inventory_review_counts(p_counts,p_approve,p_note) $$;
revoke all on function public.inventory_submit_counts(jsonb),rls_internal.inventory_submit_counts(jsonb),public.inventory_review_counts(uuid[],boolean,text),rls_internal.inventory_review_counts(uuid[],boolean,text) from public,anon;
grant execute on function public.inventory_submit_counts(jsonb),rls_internal.inventory_submit_counts(jsonb),public.inventory_review_counts(uuid[],boolean,text),rls_internal.inventory_review_counts(uuid[],boolean,text) to authenticated;
