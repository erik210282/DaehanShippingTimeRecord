CREATE OR REPLACE FUNCTION rls_internal.production_machine_bom_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare root text:=p_data->>'root_station_code';dep text:=p_data->>'dependency_station_code';ids uuid[];old public.inventory_machine_bom_links;entry uuid;batch_entry jsonb;
begin
 if auth.uid() is null or not rls_internal.catalog_access(true) then raise exception 'pr_forbidden';end if;
 if p_action='save-many' then
  if root is null or jsonb_typeof(p_data->'dependencies') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(p_data->'dependencies') not between 1 and 30 or (select count(distinct value->>'dependency_station_code') from jsonb_array_elements(p_data->'dependencies'))<>jsonb_array_length(p_data->'dependencies') then raise exception 'pr_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('machine-bom:'||root,0));
  for batch_entry in select value from jsonb_array_elements(p_data->'dependencies') order by value->>'dependency_station_code' loop
   perform rls_internal.production_machine_bom_action('save',batch_entry||jsonb_build_object('root_station_code',root));
  end loop;
  return jsonb_build_object('saved',true);
 end if;
 if p_action not in('save','delete') or root is null or dep is null or root=dep or not exists(select 1 from public.inventory_workstations where code=root) or not exists(select 1 from public.inventory_workstations where code=dep) then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('machine-bom:'||root,0));select * into old from public.inventory_machine_bom_links where root_station_code=root and dependency_station_code=dep for update;
 if old.root_station_code is not null and nullif(p_data->>'version','')::timestamptz is distinct from old.updated_at then raise exception 'mp_changed';end if;
 if p_action='delete' then delete from public.inventory_machine_bom_links where root_station_code=root and dependency_station_code=dep;return jsonb_build_object('saved',true);end if;
 if jsonb_typeof(p_data->'item_ids') is distinct from 'array' then raise exception 'pr_invalid';end if;
 select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(p_data->'item_ids');
 if cardinality(ids)>30 or (coalesce((p_data->>'enabled')::boolean,true) and cardinality(ids)=0) then raise exception 'pr_invalid';end if;
 foreach entry in array ids loop
  if not exists(select 1 from public.inventory_items i join public.inventory_workstations w on w.code=dep where i.id=entry and i.active and i.category in('FG','SEMI') and exists(select 1 from jsonb_array_elements(w.materials)m where m->>'item_id'=entry::text or coalesce(m->'item_ids','[]') ? entry::text or upper(m->>'client_part_number')=upper(i.part_number))) then raise exception 'pr_output_required';end if;
 end loop;
 insert into public.inventory_machine_bom_links(root_station_code,dependency_station_code,item_ids,enabled,updated_by) values(root,dep,ids,coalesce((p_data->>'enabled')::boolean,true),auth.uid()) on conflict(root_station_code,dependency_station_code) do update set item_ids=excluded.item_ids,enabled=excluded.enabled,updated_at=clock_timestamp(),updated_by=auth.uid();return jsonb_build_object('saved',true);
end $function$
;

