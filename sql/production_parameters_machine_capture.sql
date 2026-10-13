alter table public.production_parameter_checks add column if not exists products jsonb not null default '[]'::jsonb check(jsonb_typeof(products)='array');
create or replace function rls_internal.production_parameter_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();manager boolean;leader boolean;request uuid:=(p_data->>'id')::uuid;
 tpl public.production_parameter_templates; old_request public.production_parameter_requests;
 station public.inventory_workstations; product public.inventory_items; field jsonb; entry jsonb; readings jsonb:='[]';
 fields jsonb; names text[]:='{}'; field_id text; value text; quantity numeric; lo numeric; hi numeric; outside boolean:=false;
 recorded timestamptz; zone text; local_at timestamp; leader_name text; part_name text; item text; products jsonb:='[]'; first_item uuid;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 leader:=manager or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
 if request is null then raise exception 'pp_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('parameter:'||request,0));
 if p_action='template' then
  if not manager then raise exception 'pr_forbidden';end if;
  select * into tpl from public.production_parameter_templates where id=request for update;
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
   field_id:=field->>'id';
   if field_id is null or field_id=any(names) or length(field_id) not between 1 and 100 or length(trim(coalesce(field->>'label',''))) not between 1 and 120 or field->>'input_type' is null or field->>'input_type' not in ('numeric','text') or length(coalesce(field->>'unit',''))>30 or length(coalesce(field->>'reference',''))>200 then raise exception 'pp_invalid';end if;
   names:=array_append(names,field_id);
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if lo is not null and lo::text in ('NaN','Infinity','-Infinity') or hi is not null and hi::text in ('NaN','Infinity','-Infinity') or lo>hi or (field->>'input_type'='text' and (lo is not null or hi is not null)) then raise exception 'pp_invalid';end if;
  end loop;
  insert into public.production_parameter_templates(id,name,machine_types,station_code,item_id,fields,created_by,updated_by)
   values(request,trim(p_data->>'name'),array(select distinct jsonb_array_elements_text(p_data->'machine_types')),nullif(p_data->>'station_code',''),nullif(p_data->>'item_id','')::uuid,fields,uid,uid)
  on conflict(id) do update set name=excluded.name,machine_types=excluded.machine_types,station_code=excluded.station_code,item_id=excluded.item_id,fields=excluded.fields,version=public.production_parameter_templates.version+1,active=coalesce((p_data->>'active')::boolean,true),updated_by=uid,updated_at=now();
 elsif p_action='archive' then
  if not manager then raise exception 'pr_forbidden';end if;
  update public.production_parameter_templates set active=false,version=version+1,updated_by=uid,updated_at=now() where id=request and version=(p_data->>'version')::integer;
  if not found then raise exception 'pp_changed';end if;
 elsif p_action='capture' then
  if not leader then raise exception 'pr_forbidden';end if;
  select * into old_request from public.production_parameter_requests where id=request;
  if old_request.id is not null then
   if old_request.created_by<>uid or old_request.payload<>p_data then raise exception 'pp_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  select * into station from public.inventory_workstations where code=p_data->>'station_code' and active;
  if station.code is null then raise exception 'pr_station_required';end if;
  select * into tpl from public.production_parameter_templates where id=(p_data->>'template_id')::uuid and active for share;
  if tpl.id is null or tpl.version is distinct from (p_data->>'template_version')::integer then raise exception 'pp_changed';end if;
  if not (station.machine_type=any(tpl.machine_types)) or tpl.station_code is not null and tpl.station_code<>station.code then raise exception 'pp_invalid';end if;
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
   if product.id is null or tpl.item_id is not null and tpl.item_id<>product.id then raise exception 'pr_item_required';end if;
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
end $$;
create or replace function rls_internal.production_parameter_snapshot(p_from date,p_to date,p_station text default '',p_search text default '',p_outside boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare manager boolean; reports jsonb; total integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or length(coalesce(p_search,''))>100 then raise exception 'pr_time_invalid';end if;
 manager:=public.inventory_access('production',true);
 with base as (
  select c.*,case when jsonb_array_length(c.products)>0 then c.products else
   jsonb_agg(jsonb_build_object('item_id',c.item_id,'part_number',c.part_number,'part_name',c.part_name)) over(partition by c.capture_group_id order by c.part_number,c.id rows between unbounded preceding and unbounded following) end as capture_products
  from public.production_parameter_checks c where (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station)
 ), grouped as (
  select distinct on(capture_group_id) * from base order by capture_group_id,id
 ), eligible as (
  select (to_jsonb(g)-'capture_products')||jsonb_build_object('products',g.capture_products,
    'part_number',(select string_agg(x->>'part_number',' / ') from jsonb_array_elements(g.capture_products) x),
    'part_name',(select string_agg(x->>'part_name',' / ') from jsonb_array_elements(g.capture_products) x)) as report,g.recorded_at,g.id
  from grouped g where (coalesce(p_search,'')='' or concat_ws(' ',g.capture_products::text,g.leader_name,g.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or g.out_of_range)
 ) select (select count(*) from eligible),coalesce((select jsonb_agg(x.report order by x.recorded_at desc,x.id) from (select * from eligible order by recorded_at desc,id limit 500)x),'[]') into total,reports;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t),'reports',reports,'total',total);
end $$;
