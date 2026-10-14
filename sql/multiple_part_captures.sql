CREATE OR REPLACE FUNCTION rls_internal.production_supply_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); leader boolean; request uuid:=(p_data->>'id')::uuid; station text; ingredient uuid; qty numeric; minutes numeric; old public.production_shift_starts; entry jsonb; product jsonb; start_at timestamptz; hours integer; session uuid; goal public.production_targets; baseline jsonb; running record;
begin
 if not (rls_internal.role_activity_access('production',case when p_action like 'load%' then 'materials' else 'shifts' end)) then raise exception 'ra_denied';end if;
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action='load-batch' then
  if jsonb_typeof(p_data->'entries') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(p_data->'entries') not between 1 and 30 then raise exception 'pr_invalid';end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_data->'entries'))<>jsonb_array_length(p_data->'entries') then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'entries') order by value->>'item_id' loop
   perform rls_internal.production_supply_action('load',entry);
  end loop;
  return jsonb_build_object('saved',true);
 end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('supply-request:'||request,0));
 if p_action='load' then
  if exists(select 1 from public.production_material_loads where id=request and created_by=uid) then return jsonb_build_object('saved',true);end if;
  station:=p_data->>'station_code';ingredient:=(p_data->>'item_id')::uuid;
  qty:=nullif(p_data->>'quantity','')::numeric;minutes:=nullif(p_data->>'alert_minutes','')::numeric;
  if qty is null or qty<=0 or qty>1000000000 or minutes is null or minutes not between 1 and 480 then raise exception 'ps_load_invalid';end if;
  if not exists(select 1 from public.inventory_workstations where code=station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=ingredient and category='RAW' and active) then raise exception 'pr_item_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('supply-station:'||station,0));
  -- First allocation is a physical starting balance; prior production must not be deducted from it.
  if not exists(select 1 from public.production_material_loads where station_code=station and item_id=ingredient) then

   for running in select r.* from public.production_live_runs r where r.station_code=station and r.deleted_at is null and r.closed_at is null and exists(select 1 from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id where ib.finished_item_id=r.item_id and ib.active and not ib.archived and bl.ingredient_id=ingredient) order by r.id loop
    select value into baseline from jsonb_array_elements(coalesce(p_data->'baselines','[]'::jsonb)) where value->>'run_id'=running.id::text;
    if baseline is null or coalesce(baseline->>'quantity','') !~ '^[0-9]{1,12}$' or (baseline->>'quantity')::numeric<running.latest_quantity then raise exception 'ps_load_invalid';end if;
    insert into public.production_material_baselines(station_code,item_id,run_id,quantity) values(station,ingredient,running.id,(baseline->>'quantity')::numeric);
   end loop;
  end if;
  insert into public.production_material_loads(id,station_code,item_id,quantity,alert_minutes,created_by)
   values(request,station,ingredient,qty,minutes,uid);
  return jsonb_build_object('saved',true);
 elsif p_action='start' then
  leader:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
  if not leader then raise exception 'pr_forbidden';end if;
  select * into old from public.production_shift_starts where id=request;
  if old.id is not null then
   if old.created_by<>uid or old.payload<>p_data then raise exception 'pr_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  start_at:=nullif(p_data->>'started_at','')::timestamptz;hours:=nullif(p_data->>'shift_hours','')::integer;
  if start_at is null or start_at>clock_timestamp() or start_at<clock_timestamp()-interval '24 hours' or hours is null or hours not in(8,10) then raise exception 'pl_start_invalid';end if;
  if jsonb_typeof(p_data->'stations') is distinct from 'array' or jsonb_array_length(p_data->'stations') not between 1 and 30 or (select count(distinct value->>'station_code') from jsonb_array_elements(p_data->'stations'))<>jsonb_array_length(p_data->'stations') then raise exception 'pr_invalid';end if;
  insert into public.production_shift_starts(id,payload,created_by) values(request,p_data,uid);
  for entry in select value from jsonb_array_elements(p_data->'stations') order by value->>'station_code' loop
   station:=entry->>'station_code';
   if not exists(select 1 from public.inventory_workstations where code=station and active) then raise exception 'pr_station_required';end if;
   perform pg_advisory_xact_lock(hashtextextended(station,1));
   if exists(select 1 from public.production_live_runs where station_code=station and deleted_at is null and closed_at is null) then raise exception 'pl_station_busy';end if;
   if jsonb_typeof(entry->'item_ids') is distinct from 'array' or jsonb_array_length(entry->'item_ids') not between 1 and 30 or (select count(distinct value) from jsonb_array_elements_text(entry->'item_ids'))<>jsonb_array_length(entry->'item_ids') then raise exception 'pr_invalid';end if;
   session:=gen_random_uuid();
   for product in select value from jsonb_array_elements(entry->'item_ids') loop
    ingredient:=(product#>>'{}')::uuid;
    if not exists(select 1 from public.inventory_items where id=ingredient and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
    select * into goal from public.production_targets where item_id=ingredient and deleted_at is null;
    if goal.item_id is null then raise exception 'pl_target_missing';end if;
    qty:=case when hours=8 then goal.target_8h else goal.target_10h end;
    insert into public.production_live_runs(id,session_id,shift_start_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
    values(gen_random_uuid(),session,request,station,ingredient,start_at,uid,qty/(case when hours=10 then 9.3 else 7.5 end),2,goal.warning_percent,goal.critical_percent,hours,qty);
   end loop;
  end loop;
  return jsonb_build_object('saved',true);
 else raise exception 'pr_invalid';end if;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_rework_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request uuid:=(p_data->>'id')::uuid;report public.production_rework_reports;hold public.inventory_quality_holds;
 entry jsonb;good numeric;scrap numeric;reserved numeric;remaining numeric;person text;at_time timestamptz;zone text;
begin
 if auth.uid() is null or not public.inventory_access() then raise exception 'ra_denied';end if;
 if p_action='report-batch' then
  if jsonb_typeof(p_data->'entries') is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(p_data->'entries') not between 1 and 30 then raise exception 'pr_invalid';end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_data->'entries'))<>jsonb_array_length(p_data->'entries') then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'entries') order by value->>'hold_id' loop
   perform rls_internal.production_rework_action('report',entry);
  end loop;
  return jsonb_build_object('saved',true);
 end if;
 if request is null then raise exception 'rw_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('rework:'||request,0));
 if p_action='report' then
  if not public.inventory_access('production') or not rls_internal.role_activity_access('production','rework') then raise exception 'ra_denied';end if;
  select * into report from public.production_rework_reports where id=request;
  if report.id is not null then
   if report.created_by<>auth.uid() or report.payload<>p_data then raise exception 'rw_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  select * into hold from public.inventory_quality_holds where id=(p_data->>'hold_id')::uuid for update;
  if hold.id is null or hold.status<>'held' or hold.source_area not in ('FG','WIP') or not exists(select 1 from public.inventory_items where id=hold.item_id and category in ('FG','SEMI')) then raise exception 'rw_unavailable';end if;
  good:=nullif(p_data->>'good_quantity','')::numeric;scrap:=nullif(p_data->>'scrap_quantity','')::numeric;
  if good is null or scrap is null or good<0 or scrap<0 or good+scrap<=0 or good::text in ('NaN','Infinity','-Infinity') or scrap::text in ('NaN','Infinity','-Infinity') or length(coalesce(p_data->>'note',''))>2000 then raise exception 'rw_invalid';end if;
  select coalesce(sum(good_quantity+scrap_quantity),0) into reserved from public.production_rework_reports where hold_id=hold.id and status='pending';
  remaining:=hold.quantity-hold.released_quantity-hold.rejected_quantity-reserved;
  if good+scrap>remaining then raise exception 'rw_exceeds';end if;
  at_time:=nullif(p_data->>'recorded_at','')::timestamptz;zone:=p_data->>'timezone';
  if at_time is null or at_time>clock_timestamp()+interval '1 minute' or zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
  select nombre into person from public.operadores where uid=auth.uid() limit 1;
  if nullif(trim(person),'') is null then raise exception 'pp_leader_missing';end if;
  insert into public.production_rework_reports(id,hold_id,good_quantity,scrap_quantity,recorded_at,timezone,note,created_by,reporter_name,payload)
   values(request,hold.id,good,scrap,at_time,zone,coalesce(p_data->>'note',''),auth.uid(),person,p_data);
 elsif p_action in ('approve','reject') then
  if not public.inventory_access('quality',true) or not rls_internal.role_activity_access('quality','quality') then raise exception 'ra_denied';end if;
  select * into report from public.production_rework_reports where id=request;
  if report.id is null then raise exception 'rw_unavailable';end if;
  -- Lock the hold before the report, matching report creation and legacy resolution.
  select * into hold from public.inventory_quality_holds where id=report.hold_id for update;
  select * into report from public.production_rework_reports where id=request for update;
  if report.status=(case when p_action='approve' then 'approved' else 'rejected' end) then return jsonb_build_object('saved',true);end if;
  if report.status<>'pending' or hold.status<>'held' then raise exception 'rw_unavailable';end if;
  if length(coalesce(p_data->>'note',''))>2000 or p_action='reject' and nullif(trim(p_data->>'note'),'') is null then raise exception 'rw_note_required';end if;
  if p_action='approve' then
   good:=report.good_quantity;scrap:=report.scrap_quantity;
   if good+scrap>hold.quantity-hold.released_quantity-hold.rejected_quantity then raise exception 'rw_exceeds';end if;
   if good>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by) values
     (hold.item_id,'HOLD',-good,'QUALITY_RELEASE','rework-good-out:'||request,report.note,hold.lot,auth.uid()),
     (hold.item_id,hold.source_area,good,'QUALITY_RELEASE','rework-good-in:'||request,report.note,hold.lot,auth.uid());
   end if;
   if scrap>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by) values
     (hold.item_id,'HOLD',-scrap,'QUALITY_REJECT','rework-scrap:'||request,report.note,hold.lot,auth.uid());
   end if;
   update public.inventory_quality_holds set released_quantity=released_quantity+good,rejected_quantity=rejected_quantity+scrap,
    status=case when released_quantity+rejected_quantity+good+scrap<quantity then 'held' when rejected_quantity+scrap=0 then 'released' when released_quantity+good=0 then 'rejected' else 'resolved' end,
    version=version+1,reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_data->>'note','') where id=hold.id;
  end if;
  select nombre into person from public.operadores where uid=auth.uid() limit 1;
  update public.production_rework_reports set status=case when p_action='approve' then 'approved' else 'rejected' end,
   reviewed_by=auth.uid(),reviewer_name=person,reviewed_at=now(),review_note=coalesce(p_data->>'note','') where id=request;
 else raise exception 'rw_invalid';end if;
 return jsonb_build_object('saved',true);
end $function$;

create or replace function public.inventory_part_actions(p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $batch$
declare entry jsonb;
begin
 if auth.uid() is null then raise exception 'pr_forbidden';end if;
 if p_action not in ('hold','movement','production') or jsonb_typeof(p_data->'entries') is distinct from 'array' then raise exception 'pr_invalid';end if;
 if jsonb_array_length(p_data->'entries') not between 1 and 30 then raise exception 'pr_invalid';end if;
 if (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'entries'))<>jsonb_array_length(p_data->'entries') then raise exception 'pr_invalid';end if;
 for entry in select value from jsonb_array_elements(p_data->'entries') order by value->>'item_id' loop
  if p_action='hold' then
   perform public.inventory_quality_hold((entry->>'item_id')::uuid,entry->>'area',(entry->>'quantity')::numeric,entry->>'reason',coalesce(entry->>'lot',''));
  elsif p_action='movement' then
   perform public.inventory_post_movement((entry->>'item_id')::uuid,entry->>'area',(entry->>'delta')::numeric,entry->>'kind',coalesce(entry->>'note',''),'','',coalesce((entry->>'date')::date,current_date));
  else
   perform public.inventory_record_production((entry->>'item_id')::uuid,coalesce((entry->>'date')::date,current_date),(entry->>'good')::numeric,(entry->>'waste')::numeric,0,coalesce(entry->>'note',''));
  end if;
 end loop;
 return jsonb_build_object('saved',true);
end $batch$;
revoke all on function public.inventory_part_actions(text,jsonb) from public,anon;
grant execute on function public.inventory_part_actions(text,jsonb) to authenticated;

alter table public.production_parameter_templates add column if not exists item_ids uuid[] not null default '{}';
update public.production_parameter_templates set item_ids=array[item_id] where item_id is not null and cardinality(item_ids)=0;
CREATE OR REPLACE FUNCTION rls_internal.production_parameter_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();manager boolean;leader boolean;request uuid:=(p_data->>'id')::uuid;
 tpl public.production_parameter_templates; old_request public.production_parameter_requests;
 station public.inventory_workstations; product public.inventory_items; field jsonb; entry jsonb; readings jsonb:='[]';
 fields jsonb; names text[]:='{}'; field_id text; value text; quantity numeric; lo numeric; hi numeric; outside boolean:=false;
 recorded timestamptz; zone text; local_at timestamp; leader_name text; part_name text; item text; products jsonb:='[]'; first_item uuid;
begin
 if not (rls_internal.role_activity_access('production',case when p_action='capture' then 'parameters' else 'parameter-settings' end)) then raise exception 'ra_denied';end if;
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 leader:=manager or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
 if request is null then raise exception 'pp_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('parameter:'||request,0));
 if p_action='template' then
  if p_data ? 'item_ids' then
   if jsonb_typeof(p_data->'item_ids') is distinct from 'array' then raise exception 'pp_invalid';end if;
   if jsonb_array_length(p_data->'item_ids')>30 or exists(select 1 from jsonb_array_elements_text(p_data->'item_ids') id where not exists(select 1 from public.inventory_items i where i.id=id::uuid and i.active and i.category in ('FG','SEMI'))) then raise exception 'pr_item_required';end if;
   p_data:=p_data||jsonb_build_object('item_id',case when jsonb_array_length(p_data->'item_ids')=1 then p_data->'item_ids'->>0 else null end);
  end if;
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
  update public.production_parameter_templates set item_ids=case when p_data ? 'item_ids' then array(select distinct id::uuid from jsonb_array_elements_text(p_data->'item_ids') id) when nullif(p_data->>'item_id','') is not null then array[(p_data->>'item_id')::uuid] else '{}'::uuid[] end where id=request;
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
end $function$;
