CREATE OR REPLACE FUNCTION rls_internal.production_parameter_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();manager boolean;leader boolean;request uuid:=(p_data->>'id')::uuid;
 tpl public.production_parameter_templates; old_request public.production_parameter_requests;
 station public.inventory_workstations; product public.inventory_items; field jsonb; entry jsonb; readings jsonb:='[]';
 fields jsonb; normalized_fields jsonb:='[]'; ref_matches text[]; ref_first numeric; ref_second numeric; names text[]:='{}'; field_id text; value text; quantity numeric; lo numeric; hi numeric; outside boolean:=false;
 recorded timestamptz; zone text; local_at timestamp; leader_name text; part_name text; item text; products jsonb:='[]'; first_item uuid;
begin
 if not (rls_internal.role_activity_access('production',case when p_action='capture' then 'parameters' else 'parameter-settings' end)) then raise exception 'ra_denied';end if;
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 leader:=manager or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
 if request is null then raise exception 'pp_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('parameter:'||request,0));
 if p_action='template' then
  if p_data ? 'station_codes' then
   if jsonb_typeof(p_data->'station_codes') is distinct from 'array' then raise exception 'pp_invalid';end if;
  else
   p_data:=p_data||jsonb_build_object('station_codes',case when nullif(p_data->>'station_code','') is null then '[]'::jsonb else jsonb_build_array(p_data->>'station_code') end);
  end if;
  if jsonb_array_length(p_data->'station_codes')>500 or exists(select 1 from jsonb_array_elements_text(p_data->'station_codes') chosen(code) where chosen.code is null or not exists(select 1 from public.inventory_workstations s where s.code=chosen.code and s.active and s.machine_type in(select jsonb_array_elements_text(p_data->'machine_types')))) then raise exception 'pr_station_required';end if;
  p_data:=p_data||jsonb_build_object('station_code',case when jsonb_array_length(p_data->'station_codes')=1 then p_data->'station_codes'->>0 else null end);
  if p_data ? 'item_ids' then
   if jsonb_typeof(p_data->'item_ids') is distinct from 'array' then raise exception 'pp_invalid';end if;
   if jsonb_array_length(p_data->'item_ids')>30 or exists(select 1 from jsonb_array_elements_text(p_data->'item_ids') id where not exists(select 1 from public.inventory_items i where i.id=id::uuid and i.active and i.category in ('FG','SEMI'))) then raise exception 'pr_item_required';end if;
   p_data:=p_data||jsonb_build_object('item_id',case when jsonb_array_length(p_data->'item_ids')=1 then p_data->'item_ids'->>0 else null end);
  end if;
  if not manager then raise exception 'pr_forbidden';end if;
  select * into tpl from public.production_parameter_templates where id=request for update;
  if tpl.deleted_at is not null then raise exception 'pp_changed';end if;
  if tpl.id is not null and tpl.version is distinct from (p_data->>'version')::integer then raise exception 'pp_changed';end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 120 or jsonb_typeof(p_data->'machine_types') is distinct from 'array' or jsonb_array_length(p_data->'machine_types') not between 1 and 20 then raise exception 'pp_invalid';end if;
  for item in select jsonb_array_elements_text(p_data->'machine_types') loop
   if length(trim(item)) not between 1 and 100 then raise exception 'pp_invalid';end if;
  end loop;
  if nullif(p_data->>'station_code','') is not null and not exists(select 1 from public.inventory_workstations where code=p_data->>'station_code' and active and machine_type in(select jsonb_array_elements_text(p_data->'machine_types'))) then raise exception 'pr_station_required';end if;
  if nullif(p_data->>'item_id','') is not null and not exists(select 1 from public.inventory_items where id=(p_data->>'item_id')::uuid and active and category in ('FG','SEMI')) then raise exception 'pr_item_required';end if;
  fields:=p_data->'fields';
  if jsonb_typeof(fields) is distinct from 'array' or jsonb_array_length(fields) not between 1 and 100 then raise exception 'pp_invalid';end if;
  for field in select jsonb_array_elements(fields) loop
   -- Normalize grouped thousands on the server as well, including older clients.
   if field->>'input_type'='numeric' and field->>'reference' like '%,%' then
    ref_matches:=regexp_match(regexp_replace(field->>'reference','\+\s*/\s*-','±','g'),'^\s*([+-]?(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?))\s*([-–—~±])\s*([+-]?(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?))(?![0-9.,])\s*(%)?');
    if ref_matches is not null then
     ref_first:=replace(ref_matches[1],',','')::numeric;ref_second:=replace(ref_matches[3],',','')::numeric;
     if ref_matches[2]='±' then
      if ref_second<0 then raise exception 'pp_invalid';end if;
      if ref_matches[4]='%' then ref_second:=abs(ref_first)*ref_second/100;end if;
      field:=field||jsonb_build_object('minimum',ref_first-ref_second,'maximum',ref_first+ref_second);
     else field:=field||jsonb_build_object('minimum',ref_first,'maximum',ref_second);
     end if;
    end if;
   end if;
   field_id:=field->>'id';
   if field_id is null or field_id=any(names) or length(field_id) not between 1 and 100 or length(trim(coalesce(field->>'label',''))) not between 1 and 120 or field->>'input_type' is null or field->>'input_type' not in ('numeric','text') or length(coalesce(field->>'unit',''))>30 or length(coalesce(field->>'reference',''))>200 then raise exception 'pp_invalid';end if;
   names:=array_append(names,field_id);
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if lo is not null and lo::text in ('NaN','Infinity','-Infinity') or hi is not null and hi::text in ('NaN','Infinity','-Infinity') or lo>hi or (field->>'input_type'='text' and (lo is not null or hi is not null)) then raise exception 'pp_invalid';end if;
   normalized_fields:=normalized_fields||jsonb_build_array(field);
  end loop;
  fields:=normalized_fields;
  insert into public.production_parameter_templates(id,name,machine_types,station_code,item_id,fields,created_by,updated_by)
   values(request,trim(p_data->>'name'),array(select distinct jsonb_array_elements_text(p_data->'machine_types')),nullif(p_data->>'station_code',''),nullif(p_data->>'item_id','')::uuid,fields,uid,uid)
  on conflict(id) do update set name=excluded.name,machine_types=excluded.machine_types,station_code=excluded.station_code,item_id=excluded.item_id,fields=excluded.fields,version=public.production_parameter_templates.version+1,active=coalesce((p_data->>'active')::boolean,true),updated_by=uid,updated_at=now();
  update public.production_parameter_templates set item_ids=case when p_data ? 'item_ids' then array(select distinct id::uuid from jsonb_array_elements_text(p_data->'item_ids') id) when nullif(p_data->>'item_id','') is not null then array[(p_data->>'item_id')::uuid] else '{}'::uuid[] end where id=request;
  update public.production_parameter_templates set station_codes=array(select distinct code from jsonb_array_elements_text(p_data->'station_codes') code order by code) where id=request;
 elsif p_action in ('archive','reactivate','delete-template') then
  if not manager then raise exception 'pr_forbidden';end if;
  select * into tpl from public.production_parameter_templates where id=request for update;
  if tpl.id is null or tpl.deleted_at is not null or tpl.version is distinct from (p_data->>'version')::integer then raise exception 'pp_changed';end if;
  if p_action='delete-template' and tpl.active then raise exception 'pp_deactivate_first';end if;
  update public.production_parameter_templates set active=(p_action='reactivate'),deleted_at=case when p_action='delete-template' then now() else null end,version=version+1,updated_by=uid,updated_at=now() where id=request;
 elsif p_action='capture' then
  if not leader then raise exception 'pr_forbidden';end if;
  select * into old_request from public.production_parameter_requests where id=request;
  if old_request.id is not null then
   if old_request.created_by<>uid or old_request.payload<>p_data then raise exception 'pp_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  select * into station from public.inventory_workstations where code=p_data->>'station_code' and active;
  if station.code is null then raise exception 'pr_station_required';end if;
  select * into tpl from public.production_parameter_templates where id=(p_data->>'template_id')::uuid and active and deleted_at is null for share;
  if tpl.id is null or tpl.version is distinct from (p_data->>'template_version')::integer then raise exception 'pp_changed';end if;
  if not (station.machine_type=any(tpl.machine_types)) or cardinality(tpl.station_codes)>0 and not(station.code=any(tpl.station_codes)) then raise exception 'pp_invalid';end if;
  recorded:=nullif(p_data->>'recorded_at','')::timestamptz;zone:=p_data->>'timezone';
  if recorded is null or recorded>clock_timestamp()+interval '1 minute' or zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
  local_at:=recorded at time zone zone;
  -- Qualify the caller variable to avoid confusing it with the profile column.
  select o.nombre into leader_name from public.operadores o where o.uid=auth.uid() limit 1;
  if nullif(trim(leader_name),'') is null then raise exception 'pp_leader_missing';end if;
  if jsonb_typeof(p_data->'values') is distinct from 'array' or jsonb_array_length(p_data->'values')<>jsonb_array_length(tpl.fields) then raise exception 'pp_values_required';end if;
  for field in select jsonb_array_elements(tpl.fields) loop
   if (select count(*) from jsonb_array_elements(p_data->'values') x where x->>'id'=field->>'id')<>1 then raise exception 'pp_values_required';end if;
   select x into entry from jsonb_array_elements(p_data->'values') x where x->>'id'=field->>'id';
   value:=trim(coalesce(entry->>'value',''));
   if length(value) not between 1 and 500 or length(coalesce(entry->>'note',''))>1000 then raise exception 'pp_values_required';end if;
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if field->>'input_type'='numeric' then
    if value !~ '^-?[0-9]+([.][0-9]+)?$' then raise exception 'pp_values_required';end if;
    quantity:=value::numeric;
   else quantity:=null;
   end if;
   outside:=outside or coalesce(quantity<lo or quantity>hi,false);
   readings:=readings||jsonb_build_array(field||jsonb_build_object('value',value,'note',coalesce(entry->>'note',''),'out_of_range',coalesce(quantity<lo or quantity>hi,false)));
  end loop;
  if jsonb_typeof(p_data->'item_ids') is distinct from 'array' or jsonb_array_length(p_data->'item_ids') not between 1 and 30 or (select count(distinct x) from jsonb_array_elements_text(p_data->'item_ids') x)<>jsonb_array_length(p_data->'item_ids') or length(coalesce(p_data->>'shift',''))>30 or length(coalesce(p_data->>'note',''))>2000 then raise exception 'pp_invalid';end if;
  insert into public.production_parameter_requests(id,payload,created_by) values(request,p_data,uid);
  for item in select jsonb_array_elements_text(p_data->'item_ids') loop
   select * into product from public.inventory_items where id=item::uuid and active and category in ('FG','SEMI');
   if product.id is null or cardinality(tpl.item_ids)>0 and not(product.id=any(tpl.item_ids)) or cardinality(tpl.item_ids)=0 and tpl.item_id is not null and tpl.item_id<>product.id then raise exception 'pr_item_required';end if;
   select coalesce(p.nombre,product.part_name,product.description,'') into part_name from (select 1) dummy left join public.productos p on p.id=product.producto_id;
   if first_item is null then first_item:=product.id;end if;
   products:=products||jsonb_build_array(jsonb_build_object('item_id',product.id,'part_number',product.part_number,'part_name',part_name));
  end loop;
  insert into public.production_parameter_checks(capture_group_id,station_code,item_id,products,template_id,template_version,recorded_at,recorded_date,recorded_time,timezone,shift,leader_id,leader_name,station_name,part_number,part_name,template_name,readings,note,out_of_range)
  values(request,station.code,first_item,products,tpl.id,tpl.version,recorded,local_at::date,local_at::time,zone,'',uid,leader_name,station.name,
   (select string_agg(x->>'part_number',' / ') from jsonb_array_elements(products) x),
   (select string_agg(x->>'part_name',' / ') from jsonb_array_elements(products) x),tpl.name,readings,coalesce(p_data->>'note',''),outside);
 else raise exception 'pp_invalid';
 end if;
 return jsonb_build_object('saved',true);
end $function$
;

