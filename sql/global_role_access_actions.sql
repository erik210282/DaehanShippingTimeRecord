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

CREATE OR REPLACE FUNCTION rls_internal.production_live_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; entry jsonb; lr public.production_live_runs; zone text; start_local timestamp; finish_local timestamp; elapsed numeric; unplanned numeric; planned numeric; breaks integer; events jsonb;
begin
 if not (rls_internal.role_activity_access('production',case when p_action like 'target%' then 'targets' else 'partial' end) or (p_action in ('start','start_batch','finish','finish_batch','close','close_batch') and rls_internal.role_activity_access('production','shifts'))) then raise exception 'ra_denied';end if;
 result:=rls_internal.production_live_action_progress_base(p_action,p_data);
 if p_action in ('finish','finish_batch') then
  for entry in select value from jsonb_array_elements(case when p_action='finish_batch' then p_data->'products' else jsonb_build_array(p_data) end) loop
   select * into lr from public.production_live_runs where id=(entry->>'run_id')::uuid;
   if lr.id is null or lr.closed_at is null then raise exception 'pr_invalid';end if;
   zone:=coalesce(nullif(entry->>'timezone',''),'UTC');
   if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
   start_local:=lr.started_at at time zone zone;finish_local:=lr.closed_at at time zone zone;
   elapsed:=extract(epoch from lr.closed_at-lr.started_at)/60;
   select coalesce(jsonb_agg(jsonb_build_object('type',e->>'type','note',coalesce(e->>'note',''),'start_time',to_char((e->>'start_at')::timestamptz at time zone zone,'HH24:MI'),'end_time',to_char((e->>'end_at')::timestamptz at time zone zone,'HH24:MI'),'minutes',extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60)),'[]'::jsonb),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' not in ('break','lunch')),0),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' in ('break','lunch')),0),
    count(*) filter(where e->>'type' in ('break','lunch'))
   into events,unplanned,planned,breaks from jsonb_array_elements(lr.downtime_events) e;
   insert into public.production_station_reports(id,live_run_id,capture_group_id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,break_minutes,break_count,people,machine_quantity,scrap_quantity,rework_quantity,full_boxes,report_mode,downtime_events,status,created_by,progress_draft)
   values(gen_random_uuid(),lr.id,lr.session_id,lr.station_code,lr.item_id,(select id from public.inventory_boms where finished_item_id=lr.item_id and active and not archived limit 1),start_local::date,start_local::time,finish_local::time,start_local::date<>finish_local::date,elapsed,greatest(0,elapsed-unplanned-planned),unplanned,planned,breaks,null,lr.latest_quantity,null,null,null,'production',events,'draft',auth.uid(),true)
   on conflict (live_run_id) where live_run_id is not null and report_mode='production' do nothing;
  end loop;
 end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_station_action(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb; entries jsonb:='[]'; draft public.production_station_reports; capture uuid; all_existing boolean:=true;
begin
 if not (rls_internal.role_activity_access('production','records')) then raise exception 'ra_denied';end if;
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in ('save','submit') then
  if p_data ? 'products' then
   if jsonb_typeof(p_data->'products') is distinct from 'array' then raise exception 'pr_invalid';end if;
   for entry in select value from jsonb_array_elements(p_data->'products') loop
    select * into draft from public.production_station_reports where live_run_id=nullif(entry->>'live_run_id','')::uuid and report_mode='production' and status='draft';
    if draft.id is not null then
     entry:=entry||jsonb_build_object('id',draft.id);
     if capture is null then capture:=draft.capture_group_id;
     elsif capture is distinct from draft.capture_group_id then raise exception 'pr_invalid';end if;
    else all_existing:=false;
    end if;
    entries:=entries||jsonb_build_array(entry);
   end loop;
   p_data:=p_data||jsonb_build_object('products',entries);
   if all_existing and capture is not null then p_data:=p_data||jsonb_build_object('capture_group_id',capture);end if;
  else
   select * into draft from public.production_station_reports where live_run_id=nullif(p_data->>'live_run_id','')::uuid and report_mode='production' and status='draft';
   if draft.id is not null then p_data:=p_data||jsonb_build_object('id',draft.id);end if;
  end if;
 end if;
 return rls_internal.production_station_action_capture_base(p_action,p_data);
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.inventory_confirm_dispatch(p_idx text, p_date date, p_lines jsonb, p_note text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_line record; v_count integer;
begin
 if not (rls_internal.role_activity_access('inventory','dispatch')) then raise exception 'ra_denied';end if;
  if not public.inventory_access('shipping',true) or nullif(btrim(p_idx),'') is null
     or p_date is null or p_date > (now() at time zone 'America/Los_Angeles')::date
     or jsonb_typeof(p_lines)<>'array' then raise exception 'Confirmación de envío inválida'; end if;
  if not exists (select 1 from public.actividades_realizadas r join public.actividades a
      on a.id::text=r.actividad where r.idx=p_idx and lower(a.nombre)='load' and r.estado='finalizada')
     then raise exception 'El IDX no tiene un LOAD finalizado'; end if;
  select count(*) into v_count from public.shipping_lines where idx=p_idx;
  if v_count=0 or v_count<>jsonb_array_length(p_lines) then
    raise exception 'Confirme todas las líneas del IDX'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) v
       where (v->>'pieces_per_box') is null or (v->>'pieces_per_box') !~ '^[0-9]+(\.[0-9]+)?$'
         or (v->>'pieces_per_box')::numeric<=0)
     then raise exception 'Indique piezas por caja para cada línea'; end if;
  insert into public.inventory_dispatches(idx,ship_date,confirmed_by,note)
    values(p_idx,p_date,auth.uid(),coalesce(p_note,''));
  for v_line in
    select l.id,l.producto,l.cantidad_cajas,i.id as item_id,
      (v->>'pieces_per_box')::numeric as per_box
    from jsonb_array_elements(p_lines) v
    join public.shipping_lines l on l.id=(v->>'line_id')::uuid and l.idx=p_idx
    join public.inventory_items i on i.producto_id=l.producto and i.category='FG'
  loop
    insert into public.inventory_dispatch_lines(idx,shipping_line_id,item_id,boxes,pieces_per_box)
      values(p_idx,v_line.id,v_line.item_id,v_line.cantidad_cajas,v_line.per_box);
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
      values(v_line.item_id,'FG',-(v_line.cantidad_cajas*v_line.per_box),'SHIPMENT',
        'dispatch:'||v_line.id,coalesce(p_note,''),p_date,auth.uid());
  end loop;
  if (select count(*) from public.inventory_dispatch_lines where idx=p_idx)<>v_count
    then raise exception 'Faltan líneas o productos en el catálogo'; end if;
  return p_idx;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.inventory_post_movement(p_item uuid, p_area text, p_delta numeric, p_kind text, p_note text DEFAULT ''::text, p_location text DEFAULT ''::text, p_lot text DEFAULT ''::text, p_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_category text; v_department text;
begin
 if not (rls_internal.role_activity_access('inventory',p_area)) then raise exception 'ra_denied';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.inventory_review_counts(p_counts uuid[], p_approve boolean, p_note text DEFAULT ''::text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid uuid;
begin
 if not (rls_internal.role_activity_access('inventory','counts')) then raise exception 'ra_denied';end if;
 if auth.uid() is null or p_counts is null or cardinality(p_counts) not between 1 and 100 or p_approve is null then raise exception 'inv_review_quantities';end if;
 for cid in select distinct x from unnest(p_counts) x order by x loop
  perform rls_internal.inventory_review_count(cid,p_approve,p_note);
 end loop;
 return p_counts;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.inventory_submit_count(p_department text, p_area text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_line jsonb; v_item uuid; v_expected numeric;
begin
 if not (rls_internal.role_activity_access('inventory','counts')) then raise exception 'ra_denied';end if;
  if not public.inventory_access(p_department) or p_area not in ('RAW','WIP','FG','PACKAGING','HOLD')
     or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0
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

CREATE OR REPLACE FUNCTION rls_internal.production_delete_shift(p_session uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare leader boolean;
begin
 if not (rls_internal.role_activity_access('production','shifts')) then raise exception 'ra_denied';end if;
 leader:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 if auth.uid() is null or not leader then raise exception 'pr_forbidden';end if;
 perform 1 from public.production_live_runs where coalesce(session_id,id)=p_session and deleted_at is null order by id for update;
 if not found then raise exception 'pr_invalid';end if;
 if exists(select 1 from public.production_station_reports d join public.production_live_runs r on r.id=d.live_run_id where coalesce(r.session_id,r.id)=p_session and not d.progress_draft) then raise exception 'ps_shift_report_exists';end if;
 delete from public.production_station_reports d using public.production_live_runs r where d.live_run_id=r.id and coalesce(r.session_id,r.id)=p_session and d.progress_draft and d.status='draft';
 update public.production_live_runs set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid() where coalesce(session_id,id)=p_session and deleted_at is null;
 return true;
end $function$;

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
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.receiving_putaway_group(p_id uuid, p_line uuid, p_location uuid, p_quantity numeric, p_operators jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_line public.receiving_lines%rowtype; v_reserved numeric; v_others uuid[];
begin
 if not (rls_internal.role_activity_access('receiving','putaway')) then raise exception 'ra_denied';end if;
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.receiving_tasks where id=p_id and operator_id=auth.uid()) then return p_id; end if;
 v_others:=rls_internal.receiving_operators(auth.uid(),p_operators);
 select * into v_line from public.receiving_lines where id=p_line for update;
 if not found or not exists(select 1 from public.receiving_receipts where id=v_line.receipt_id and status='received') then raise exception 'receiving_invalid'; end if;
 select coalesce(sum(quantity),0) into v_reserved from public.receiving_tasks where line_id=p_line and status<>'cancelled';
 if p_quantity is null or p_quantity<=0 or p_quantity>v_line.received-v_reserved then raise exception 'receiving_quantity'; end if;
 if not exists(select 1 from public.receiving_locations where id=p_location and active and not is_system_stage) then raise exception 'receiving_location'; end if;
 if exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id)
 and not exists(select 1 from public.receiving_item_locations where item_id=v_line.item_id and location_id=p_location) then raise exception 'receiving_location'; end if;
 insert into public.receiving_tasks(id,receipt_id,kind,line_id,location_id,quantity,operator_id,additional_operator_ids)
 values(p_id,v_line.receipt_id,'putaway',p_line,p_location,p_quantity,auth.uid(),v_others);
 return p_id;
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.receiving_start(p_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_stage uuid; v_others uuid[]; v_line jsonb; v_operator uuid := coalesce(nullif(p_data->>'operator_id','')::uuid,auth.uid());
begin
 if not (rls_internal.role_activity_access('receiving','unload')) then raise exception 'ra_denied';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.receiving_task(p_id uuid, p_action text, p_lines jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_task public.receiving_tasks%rowtype; v_receipt public.receiving_receipts%rowtype;
 v_line public.receiving_lines%rowtype; v_data jsonb; v_area text; v_received numeric; v_damaged numeric; v_item record;
begin
 if not (rls_internal.role_activity_access('receiving',case when exists(select 1 from public.receiving_tasks where id=p_id and kind='putaway') then 'putaway' else 'unload' end)) then raise exception 'ra_denied';end if;
 if not rls_internal.receiving_access() then raise exception 'receiving_forbidden'; end if;
 -- Consistent locking order with start/hold: receipt or line, then task.
 select * into v_task from public.receiving_tasks where id=p_id;
 if not found then raise exception 'receiving_invalid'; end if;
 if v_task.kind='putaway' then perform 1 from public.receiving_lines where id=v_task.line_id for update;
 else perform 1 from public.receiving_receipts where id=v_task.receipt_id for update; end if;
 select * into v_task from public.receiving_tasks where id=p_id for update;
 if v_task.operator_id<>auth.uid() and not (auth.uid()=any(v_task.additional_operator_ids)) and not rls_internal.inventory_access('receiving',true) then raise exception 'receiving_forbidden'; end if;
 if (v_task.status='finished' and p_action='finish') or (v_task.status='cancelled' and p_action='cancel')
 or (v_task.status='paused' and p_action='pause') or (v_task.status='running' and p_action='resume') then return p_id; end if;
 if v_task.status not in ('running','paused') then raise exception 'receiving_closed'; end if;
 if p_action='pause' and v_task.status='running' then
 update public.receiving_tasks set status='paused',paused_at=now() where id=p_id;
 elsif p_action='resume' and v_task.status='paused' then
 update public.receiving_tasks set status='running',pause_seconds=pause_seconds+extract(epoch from now()-paused_at),paused_at=null where id=p_id;
 elsif p_action in ('finish','cancel') then
 select * into v_receipt from public.receiving_receipts where id=v_task.receipt_id;
 if p_action='finish' and v_task.kind='unload' then
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<>(select count(*) from public.receiving_lines where receipt_id=v_receipt.id)
 or (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines)
 then raise exception 'receiving_invalid'; end if;
 for v_line in select * from public.receiving_lines where receipt_id=v_receipt.id for update loop
 select value into v_data from jsonb_array_elements(p_lines) where value->>'id'=v_line.id::text;
 v_received:=(v_data->>'received')::numeric; v_damaged:=(v_data->>'damaged')::numeric;
 if v_received is null or v_damaged is null or v_received<0 or v_damaged<0 or v_damaged>v_received
 or v_received::text in ('NaN','Infinity','-Infinity') or v_damaged::text in ('NaN','Infinity','-Infinity')
 or (v_damaged>0 and nullif(btrim(v_data->>'note'),'') is null) then raise exception 'receiving_quantity'; end if;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 update public.receiving_lines set received=v_received,damaged=v_damaged,note=coalesce(v_data->>'note','') where id=v_line.id;
 if v_received>0 then
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,note,created_by)
 select v_line.item_id,v_area,v_received,'RECEIPT',code,v_line.lot,'receiving:'||v_line.id,coalesce(v_data->>'note',''),auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 end if;
 end loop;
 update public.receiving_receipts set status='received',received_at=now() where id=v_receipt.id;
 elsif p_action='finish' and v_task.kind='putaway' then
 select * into v_line from public.receiving_lines where id=v_task.line_id;
 select category into v_area from public.inventory_items where id=v_line.item_id;
 if exists(select 1 from public.inventory_quality_holds where id=v_line.hold_id and status='held') then v_area:='HOLD'; end if;
 -- Equal debit and credit: putaway never receives the stock a second time.
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,-v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-out:'||p_id,auth.uid() from public.receiving_locations where id=v_receipt.staging_id;
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,location,lot,reference_key,created_by)
 select v_line.item_id,v_area,v_task.quantity,'TRANSFER',code,v_line.lot,'receiving-putaway-in:'||p_id,auth.uid() from public.receiving_locations where id=v_task.location_id;
 elsif p_action='cancel' and v_task.kind='unload' then
 update public.receiving_receipts set status='cancelled' where id=v_receipt.id;
 end if;
 update public.receiving_tasks set status=case when p_action='finish' then 'finished' else 'cancelled' end,
 finished_at=now(),pause_seconds=pause_seconds+case when paused_at is not null then extract(epoch from now()-paused_at) else 0 end,paused_at=null where id=p_id;
 else raise exception 'receiving_invalid'; end if;
 return p_id;
end $function$;

