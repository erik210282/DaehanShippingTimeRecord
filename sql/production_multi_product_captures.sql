alter table public.production_station_reports add column capture_group_id uuid;
create index production_capture_group on public.production_station_reports(capture_group_id) where capture_group_id is not null;
alter table public.production_live_runs add column session_id uuid;
update public.production_live_runs set session_id=id;
alter table public.production_live_runs alter column session_id set default gen_random_uuid(),alter column session_id set not null;
drop index public.production_one_active_station;
create unique index production_one_active_station_product on public.production_live_runs(station_code,item_id) where closed_at is null and deleted_at is null;
create index production_live_session on public.production_live_runs(session_id);
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=(p_data->>'id')::uuid;v_old public.production_station_reports%rowtype;v_report public.production_station_reports%rowtype;v_station public.inventory_workstations%rowtype;v_item public.inventory_items%rowtype;v_bom public.inventory_boms%rowtype;v_profile public.inventory_bom_packaging%rowtype;v_row record;v_elapsed numeric;v_repack boolean;v_ledger uuid;v_qty numeric;v_balance numeric;v_can_manage boolean;v_packing jsonb;v_good integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if v_id is null then raise exception 'pr_invalid';end if;
 v_can_manage:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 perform pg_advisory_xact_lock(hashtextextended('station-report:'||v_id,0));
 select * into v_old from public.production_station_reports where id=v_id for update;
 if v_old.id is not null and v_old.created_by<>auth.uid() and not v_can_manage then raise exception 'pr_forbidden';end if;
 if p_action='delete' then
  if v_old.id is null or v_old.status<>'draft' then raise exception 'pr_locked';end if;
  delete from public.production_station_reports where id=v_id;return v_id;
 end if;
 if p_action in ('save','submit') then
  if v_old.status in ('posted','submitted') then raise exception 'pr_locked';end if;
  select * into v_station from public.inventory_workstations where code=p_data->>'station_code' and active;
  if not found then raise exception 'pr_station_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('production-station:'||v_station.code,0));
  select * into v_item from public.inventory_items where id=(p_data->>'item_id')::uuid and active;
  if not found then raise exception 'pr_item_required';end if;
  select * into v_bom from public.inventory_boms where finished_item_id=v_item.id and active and not archived;
  v_report:=jsonb_populate_record(null::public.production_station_reports,p_data);
  v_report.rework_completed:=coalesce((p_data->>'rework_completed')::boolean,v_old.rework_completed,false);v_report.catalog_packing:=coalesce((p_data->>'catalog_packing')::boolean,v_old.catalog_packing,false);
  v_good:=v_report.machine_quantity-v_report.scrap_quantity+case when v_report.rework_completed then v_report.rework_quantity else -v_report.rework_quantity end;
  v_elapsed:=extract(epoch from (v_report.end_time-v_report.start_time))/60+case when v_report.ends_next_day then 1440 else 0 end;
  if v_report.production_date is null or v_report.start_time is null or v_report.end_time is null or v_elapsed<=0 or v_elapsed>1440 or v_report.production_date>current_date+1 or v_report.people is null or v_report.people<=0 or v_report.machine_minutes is null or v_report.machine_minutes<0 or v_report.downtime_minutes is null or v_report.downtime_minutes<0 or v_report.break_minutes is null or v_report.break_minutes<0 or v_report.machine_minutes+v_report.downtime_minutes+v_report.break_minutes>v_elapsed or v_report.break_count is null or v_report.break_count<0 or (v_report.break_count=0)<>(v_report.break_minutes=0) or (v_report.downtime_minutes>0 and nullif(btrim(v_report.downtime_reason),'') is null) or v_report.report_mode not in ('production','packing') then raise exception 'pr_time_invalid';end if;
  if v_report.machine_quantity is null or v_report.scrap_quantity is null or v_report.rework_quantity is null or v_report.full_boxes is null or v_report.pallets is null or least(v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.full_boxes,v_report.pallets)<0 or v_report.scrap_quantity>v_report.machine_quantity or v_good<0 then raise exception 'pr_quantity_invalid';end if;
  if v_station.name ~* '(turn[ ]?table|t/t)' and (v_report.turns is null or v_report.turns<0) then raise exception 'pr_turns_required';end if;
  if v_report.full_boxes>0 then
   if v_item.category<>'FG' then raise exception 'pr_pack_invalid';end if;
   select * into v_profile from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_report.packaging_type;
   if v_report.catalog_packing then
    v_packing:=rls_internal.production_packing_profile(v_item.id,v_report.packaging_type,v_bom.id);
    if v_packing is null then raise exception 'pr_pack_catalog_required';end if;
    v_report.pieces_per_box:=(v_packing->>'pieces_per_box')::integer;
    v_report.packing_item_id:=(v_packing->>'packing_item_id')::uuid;v_report.packing_box_name:=v_packing->>'box_name';
   else
    if v_profile.bom_id is null then raise exception 'pr_pack_missing';end if;
    v_report.pieces_per_box:=v_profile.pieces_per_box;
    v_report.packing_item_id:=null;v_report.packing_box_name:=v_profile.box_name;
   end if;
   if v_report.full_boxes*v_report.pieces_per_box>v_good then raise exception 'pr_quantity_invalid';end if;
   if exists(select 1 from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_profile.packaging_type and basis='pallet') and v_report.pallets<=0 then raise exception 'pr_pallets_required';end if;
  else v_report.pieces_per_box:=0;v_report.packaging_type:=null;v_report.packing_item_id:=null;v_report.packing_box_name:=null;if v_report.pallets<>0 then raise exception 'pr_quantity_invalid';end if;end if;
  if p_action='submit' then
   if v_bom.id is null or not exists(select 1 from public.inventory_bom_lines where bom_id=v_bom.id) then raise exception 'pr_recipe_missing';end if;
   if v_item.category not in ('FG','SEMI') then raise exception 'pr_output_required';end if;
   if exists(select 1 from public.production_station_reports r where r.id<>v_id and (v_report.capture_group_id is null or r.capture_group_id is distinct from v_report.capture_group_id) and r.station_code=v_station.code and r.status in ('submitted','posted') and tsrange(r.production_date+r.start_time,r.production_date+r.end_time+case when r.ends_next_day then interval '1 day' else interval '0' end,'[)') && tsrange(v_report.production_date+v_report.start_time,v_report.production_date+v_report.end_time+case when v_report.ends_next_day then interval '1 day' else interval '0' end,'[)')) then raise exception 'pr_overlap';end if;
  end if;
  insert into public.production_station_reports(id,capture_group_id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,downtime_reason,break_count,break_minutes,people,machine_quantity,scrap_quantity,rework_quantity,packaging_type,full_boxes,pallets,pieces_per_box,turns,report_mode,note,status,created_by,rework_completed,catalog_packing,packing_item_id,packing_box_name)
  values(v_id,v_report.capture_group_id,v_station.code,v_item.id,v_bom.id,v_report.production_date,v_report.start_time,v_report.end_time,v_report.ends_next_day,v_elapsed,v_report.machine_minutes,v_report.downtime_minutes,coalesce(v_report.downtime_reason,''),v_report.break_count,v_report.break_minutes,v_report.people,v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.packaging_type,v_report.full_boxes,v_report.pallets,v_report.pieces_per_box,v_report.turns,v_report.report_mode,coalesce(v_report.note,''),case when p_action='submit' then 'submitted' else 'draft' end,coalesce(v_old.created_by,auth.uid()),v_report.rework_completed,v_report.catalog_packing,v_report.packing_item_id,v_report.packing_box_name)
  on conflict(id) do update set capture_group_id=excluded.capture_group_id,rework_completed=excluded.rework_completed,catalog_packing=excluded.catalog_packing,packing_item_id=excluded.packing_item_id,packing_box_name=excluded.packing_box_name,station_code=excluded.station_code,item_id=excluded.item_id,bom_id=excluded.bom_id,production_date=excluded.production_date,start_time=excluded.start_time,end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,downtime_reason=excluded.downtime_reason,break_count=excluded.break_count,break_minutes=excluded.break_minutes,people=excluded.people,machine_quantity=excluded.machine_quantity,scrap_quantity=excluded.scrap_quantity,rework_quantity=excluded.rework_quantity,packaging_type=excluded.packaging_type,full_boxes=excluded.full_boxes,pallets=excluded.pallets,pieces_per_box=excluded.pieces_per_box,turns=excluded.turns,report_mode=excluded.report_mode,note=excluded.note,status=excluded.status,updated_at=now();
  return v_id;
 end if;
 if p_action='return' then
  if not public.inventory_access('production',true) or v_old.status<>'submitted' then raise exception 'pr_forbidden';end if;
  update public.production_station_reports set status='draft',updated_at=now() where id=v_id;return v_id;
 end if;
 if p_action<>'post' or not public.inventory_access('production',true) or v_old.id is null then raise exception 'pr_forbidden';end if;
 if v_old.status='posted' then return v_id;end if;
 if v_old.status<>'submitted' then raise exception 'pr_locked';end if;
 select * into v_bom from public.inventory_boms where id=v_old.bom_id and active and not archived for share;
 if not found then raise exception 'pr_recipe_changed';end if;
 select * into v_item from public.inventory_items where id=v_old.item_id and active;
 if not found then raise exception 'pr_item_required';end if;
 if not exists(select 1 from public.inventory_workstations where code=v_old.station_code and active) then raise exception 'pr_station_required';end if;
 v_repack:=exists(select 1 from public.inventory_bom_lines l where l.bom_id=v_bom.id and l.ingredient_id=v_item.id);
 if v_old.report_mode='packing' then
  if v_repack or v_old.scrap_quantity<>0 or v_old.rework_quantity<>0 or v_old.good_quantity<>v_old.packed_quantity or v_old.packed_quantity<=0 then raise exception 'pr_packing_only_invalid';end if;
  insert into public.production_station_consumptions values(v_id,v_item.id,'WIP','wip',v_old.packed_quantity);
 elsif v_repack then
  if v_old.good_quantity<>v_old.packed_quantity or v_old.rework_quantity<>0 then raise exception 'pr_repack_boxes';end if;
  if v_old.machine_quantity>0 then insert into public.production_station_consumptions values(v_id,v_item.id,'FG','repack',v_old.machine_quantity);end if;
 else
  insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
   select v_id,l.ingredient_id,case when i.category='SEMI' then 'WIP' else i.category end,'manufacturing',v_old.machine_quantity*l.quantity_per_unit*(1+l.waste_rate)
   from public.inventory_bom_lines l join public.inventory_items i on i.id=l.ingredient_id where l.bom_id=v_bom.id and v_old.machine_quantity>0;
 end if;
 if v_old.full_boxes>0 then
  if v_old.catalog_packing then
   v_packing:=rls_internal.production_packing_profile(v_item.id,v_old.packaging_type,v_bom.id);
   if v_packing is null or (v_packing->>'pieces_per_box')::integer<>v_old.pieces_per_box or (v_packing->>'packing_item_id')::uuid is distinct from v_old.packing_item_id then raise exception 'pr_recipe_changed';end if;
  elsif not exists(select 1 from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_old.packaging_type and pieces_per_box=v_old.pieces_per_box) then raise exception 'pr_recipe_changed';end if;
  insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
   select v_id,ingredient_id,'PACKAGING','packing',sum(quantity*(1+waste_rate)*case basis when 'piece' then v_old.packed_quantity when 'box' then v_old.full_boxes when 'pallet' then v_old.pallets end)
   from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_old.packaging_type group by ingredient_id;
  if v_old.packing_item_id is not null and not exists(select 1 from public.production_station_consumptions where report_id=v_id and ingredient_id=v_old.packing_item_id) then
   insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity) values(v_id,v_old.packing_item_id,'PACKAGING','packing',v_old.full_boxes);
  end if;
  if not exists(select 1 from public.production_station_consumptions where report_id=v_id and source='packing') then raise exception 'pr_pack_missing';end if;
 end if;
 -- Lock each item in a consistent order; physical inventory remains untouched on failure.
 for v_row in select distinct ingredient_id from public.production_station_consumptions where report_id=v_id order by ingredient_id loop
  perform 1 from public.inventory_items where id=v_row.ingredient_id and active for update;
  if not found then raise exception 'catalog_recipe_ingredient';end if;
 end loop;
 for v_row in select ingredient_id,area,sum(quantity) quantity from public.production_station_consumptions where report_id=v_id group by ingredient_id,area loop
  select coalesce(sum(quantity_delta),0) into v_balance from public.inventory_movements where item_id=v_row.ingredient_id and area=v_row.area;
  if v_balance<v_row.quantity then raise exception 'pr_stock_short';end if;
 end loop;
 if v_old.report_mode='production' and v_old.machine_quantity>0 then
  insert into public.inventory_production_reports(item_id,bom_id,production_date,good_quantity,waste_quantity,note,created_by)
   values(v_item.id,v_bom.id,v_old.production_date,v_old.good_quantity+case when v_old.rework_completed then 0 else v_old.rework_quantity end,v_old.scrap_quantity,v_old.note,v_old.created_by) returning id into v_ledger;
  insert into public.inventory_production_inputs(report_id,ingredient_id,theoretical_quantity)
   select v_ledger,ingredient_id,sum(quantity) from public.production_station_consumptions where report_id=v_id group by ingredient_id;
 end if;
 for v_row in select * from public.production_station_consumptions where report_id=v_id loop
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by)
   values(v_row.ingredient_id,v_row.area,-v_row.quantity,'CONSUMPTION','station-input:'||v_id||':'||v_row.ingredient_id||':'||v_row.source,'Production '||v_id,v_old.production_date,auth.uid());
 end loop;
 if v_old.packed_quantity>0 then
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by) values(v_item.id,'FG',v_old.packed_quantity,'PRODUCTION','station-fg:'||v_id,v_old.note,v_old.production_date,auth.uid());
 end if;
 if not v_repack and v_old.report_mode='production' and v_old.good_quantity>v_old.packed_quantity then
  insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,effective_date,created_by) values(v_item.id,'WIP',v_old.good_quantity-v_old.packed_quantity,'WIP_IN','station-wip:'||v_id,v_old.note,v_old.production_date,auth.uid());
 end if;
 update public.production_station_reports set status='posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now(),inventory_report_id=v_ledger where id=v_id;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payload jsonb:=p_data;events jsonb:='[]'::jsonb;d jsonb;v_id uuid;shift_start integer;shift_finish integer;event_start integer;event_finish integer;duration integer;night boolean;seen int4range[]:=array[]::int4range[];span int4range;entry jsonb;common jsonb;batch_group uuid;batch_result uuid;batch_ids uuid[]:=array[]::uuid[];existing_group uuid;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;

 if p_data ? 'products' then
  if p_action not in ('save','submit') or jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 then raise exception 'pr_invalid';end if;
  batch_group:=(p_data->>'capture_group_id')::uuid;
  if batch_group is null then raise exception 'pr_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-group:'||batch_group,0));
  if exists(select 1 from public.production_station_reports where capture_group_id=batch_group and created_by<>auth.uid()) and not (public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') or (select count(distinct value->>'id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  common:=(select jsonb_object_agg(key,value) from jsonb_each((p_data->'products')->0) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode','downtime_events']));
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   if (select jsonb_object_agg(key,value) from jsonb_each(entry) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode','downtime_events'])) is distinct from common then raise exception 'pr_time_invalid';end if;
   if exists(select 1 from public.production_station_reports where id=(entry->>'id')::uuid and capture_group_id is not null and capture_group_id<>batch_group) then raise exception 'pr_invalid';end if;
   batch_ids:=array_append(batch_ids,(entry->>'id')::uuid);
  end loop;
  if exists(select 1 from public.production_station_reports r where capture_group_id=batch_group and not(id=any(batch_ids)) and
    (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)||jsonb_build_object('start_time',to_char(r.start_time,'HH24:MI'),'end_time',to_char(r.end_time,'HH24:MI'))) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode','downtime_events'])) is distinct from common) then raise exception 'pr_locked';end if;
  if exists(select 1 from public.production_station_reports where capture_group_id=batch_group and not(id=any(batch_ids)) and item_id in(select (value->>'item_id')::uuid from jsonb_array_elements(p_data->'products'))) then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   batch_result:=rls_internal.production_station_action('save',entry-'products'-'capture_group_id');
   update public.production_station_reports set capture_group_id=batch_group where id=batch_result;
  end loop;
  if p_action='submit' then
   for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
    batch_result:=rls_internal.production_station_action('submit',entry-'products');
   end loop;
  end if;
  return batch_group;
 end if;
 if p_action in('save','submit') then
  select capture_group_id into existing_group from public.production_station_reports where id=(p_data->>'id')::uuid;
  payload:=(payload-'capture_group_id')||jsonb_build_object('capture_group_id',existing_group);
 end if;

 if p_action in ('save','submit') then
  if p_data ? 'staff_names' and (jsonb_typeof(p_data->'staff_names') not in ('string','null') or length(coalesce(p_data->>'staff_names',''))>2000) then raise exception 'pr_invalid';end if;
  if p_data ? 'downtime_events' then
   if jsonb_typeof(p_data->'downtime_events') is distinct from 'array' or jsonb_array_length(p_data->'downtime_events')>1000 then raise exception 'pr_downtime_invalid';end if;
   if coalesce(p_data->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' or coalesce(p_data->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then raise exception 'pr_time_invalid';end if;
   shift_start:=extract(epoch from (p_data->>'start_time')::time)/60;
   night:=coalesce((p_data->>'ends_next_day')::boolean,false);
   shift_finish:=extract(epoch from (p_data->>'end_time')::time)/60+case when night then 1440 else 0 end;
   if shift_finish<=shift_start or shift_finish-shift_start>1440 then raise exception 'pr_time_invalid';end if;
   for d in select value from jsonb_array_elements(p_data->'downtime_events') loop
    if d ? 'start_time' or d ? 'end_time' then
     if coalesce(d->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(d->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'pr_downtime_schedule_invalid';end if;
     event_start:=extract(epoch from (d->>'start_time')::time)/60;
     event_finish:=extract(epoch from (d->>'end_time')::time)/60;
     if night and event_start<shift_start then event_start:=event_start+1440;end if;
     if night and event_finish<shift_start then event_finish:=event_finish+1440;end if;
     if event_finish<=event_start or event_start<shift_start or event_finish>shift_finish then raise exception 'pr_downtime_schedule_invalid';end if;
     span:=int4range(event_start,event_finish,'[)');
     if exists(select 1 from unnest(seen) x where x && span) then raise exception 'pr_downtime_overlap';end if;
     seen:=array_append(seen,span);duration:=event_finish-event_start;
     d:=d||jsonb_build_object('minutes',duration);
    end if;
    events:=events||jsonb_build_array(d);
   end loop;
   payload:=payload||jsonb_build_object('downtime_events',events);
  end if;
 end if;
 v_id:=rls_internal.production_station_action_duration_core(p_action,payload);
 if p_action in ('save','submit') and p_data ? 'staff_names' then
  update public.production_station_reports set staff_names=btrim(coalesce(p_data->>'staff_names','')) where id=v_id;
 end if;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION rls_internal.production_live_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();manager boolean;v_now timestamptz:=clock_timestamp();v_id uuid;v_item uuid;v_station text;v_start timestamptz;v_quantity bigint;v_hours integer;v_target numeric;r public.production_live_runs;t public.production_targets;c public.production_checkpoints;v_session uuid;entry jsonb;result jsonb;results jsonb:='[]'::jsonb;existed boolean;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 if p_action in ('checkpoint_batch','target_batch') then
  if jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 or (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'item_id' loop
   existed:=exists(select 1 from public.production_checkpoints where id=nullif(entry->>'id','')::uuid);
   result:=rls_internal.production_live_action(case when p_action='target_batch' then 'target' else 'checkpoint' end,entry);
   if p_action='checkpoint_batch' and not existed then
    update public.production_checkpoints set recorded_at=v_now where id=(entry->>'id')::uuid;
    perform rls_internal.production_live_recalculate((entry->>'run_id')::uuid);
    select to_jsonb(x) into result from public.production_checkpoints x where id=(entry->>'id')::uuid;
   end if;
   results:=results||jsonb_build_array(result);
  end loop;
  return jsonb_build_object('saved',true,'products',results);
 end if;
 if p_action in('target','delete_target','restore_target') then
  if not manager then raise exception 'pr_forbidden';end if;
  v_item:=(p_data->>'item_id')::uuid;
  if p_action<>'target' then
   update public.production_targets set deleted_at=case when p_action='delete_target' then v_now else null end,updated_by=uid,updated_at=v_now where item_id=v_item;
   return jsonb_build_object('saved',true);
  end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  -- Preserve compatibility with installed older mobile clients during rollout.
  if p_data ? 'target_8h' then
   if coalesce(p_data->>'target_8h','') !~ '^[0-9]{1,9}$' or coalesce(p_data->>'target_10h','') !~ '^[0-9]{1,9}$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=(p_data->>'target_8h')::bigint;t.target_10h:=(p_data->>'target_10h')::bigint;
  else
   if coalesce(p_data->>'pieces_per_hour','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=round((p_data->>'pieces_per_hour')::numeric*8);t.target_10h:=round((p_data->>'pieces_per_hour')::numeric*10);
  end if;
  if coalesce(p_data->>'warning_percent','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'critical_percent','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
  t.warning_percent:=(p_data->>'warning_percent')::numeric;t.critical_percent:=(p_data->>'critical_percent')::numeric;
  if t.target_8h<=0 or t.target_10h<=0 or t.target_8h>100000000 or t.target_10h>100000000 or t.warning_percent>100 or t.critical_percent<=0 or t.critical_percent>=t.warning_percent then raise exception 'pl_target_invalid';end if;
  insert into public.production_targets(item_id,target_8h,target_10h,pieces_per_hour,interval_hours,warning_percent,critical_percent,updated_by,updated_at)
  values(v_item,t.target_8h,t.target_10h,t.target_8h::numeric/8,2,t.warning_percent,t.critical_percent,uid,v_now)
  on conflict(item_id) do update set target_8h=excluded.target_8h,target_10h=excluded.target_10h,pieces_per_hour=excluded.pieces_per_hour,warning_percent=excluded.warning_percent,critical_percent=excluded.critical_percent,updated_by=uid,updated_at=v_now,deleted_at=null;
  return jsonb_build_object('saved',true);
 end if;
 if p_action in('edit_checkpoint','delete_checkpoint','restore_checkpoint') then
  v_id:=(p_data->>'id')::uuid;
  select * into c from public.production_checkpoints where id=v_id;
  if c.id is null then raise exception 'pr_invalid';end if;
  select * into r from public.production_live_runs where id=c.run_id for update;
  if r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='edit_checkpoint' then
   if c.deleted_at is not null then raise exception 'pl_report_deleted';end if;
   if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
   update public.production_checkpoints set quantity=(p_data->>'quantity')::bigint,updated_at=v_now,updated_by=uid where id=v_id;
  else
   update public.production_checkpoints set deleted_at=case when p_action='delete_checkpoint' then v_now else null end,updated_at=v_now,updated_by=uid where id=v_id;
  end if;
  perform rls_internal.production_live_recalculate(r.id);
  select * into c from public.production_checkpoints where id=v_id;
  return to_jsonb(c);
 end if;
 if p_action in('close','edit_run','delete_run','restore_run') then
  select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
  if r.id is null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='delete_run' then
   update public.production_live_runs set deleted_at=v_now,updated_at=v_now,updated_by=uid where id=r.id;
  elsif p_action='restore_run' then
   perform pg_advisory_xact_lock(hashtextextended(r.station_code,1));
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=r.station_code and id<>r.id and (session_id<>r.session_id or item_id=r.item_id) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   update public.production_live_runs set deleted_at=null,updated_at=v_now,updated_by=uid where id=r.id;
  elsif r.deleted_at is not null then raise exception 'pl_report_deleted';
  elsif p_action='close' then
   update public.production_live_runs set closed_at=coalesce(closed_at,v_now),updated_at=v_now,updated_by=uid where id=r.id;
  else
   v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=(p_data->>'shift_hours')::integer;
   if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
   if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
   if v_start is null or v_start>=coalesce((select min(recorded_at) from public.production_checkpoints where run_id=r.id and deleted_at is null),v_now) or v_hours not in(8,10) or v_hours is null then raise exception 'pl_start_invalid';end if;
   perform pg_advisory_xact_lock(hashtextextended(v_station,1));
   if exists(select 1 from public.production_live_runs x where x.id<>r.id and x.session_id=r.session_id and x.deleted_at is null and (x.station_code<>v_station or x.started_at<>v_start or x.shift_hours<>v_hours)) then raise exception 'pr_time_invalid';end if;
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=v_station and id<>r.id and (session_id<>r.session_id or item_id=v_item) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   if r.item_id<>v_item or r.shift_hours<>v_hours then
    select * into t from public.production_targets where item_id=v_item and deleted_at is null;
    if t.item_id is null then raise exception 'pl_target_missing';end if;
    v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
   else v_target:=r.shift_target;end if;
   update public.production_live_runs set station_code=v_station,item_id=v_item,started_at=v_start,shift_hours=v_hours,shift_target=v_target,pieces_per_hour=v_target/v_hours,warning_percent=case when r.item_id<>v_item then t.warning_percent else r.warning_percent end,critical_percent=case when r.item_id<>v_item then t.critical_percent else r.critical_percent end,updated_at=v_now,updated_by=uid where id=r.id;
   perform rls_internal.production_live_recalculate(r.id);
  end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_action is distinct from 'checkpoint' then raise exception 'pr_invalid';end if;
 v_id:=(p_data->>'id')::uuid;
 if v_id is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
 select * into c from public.production_checkpoints where id=v_id;
 if c.id is not null then
  if c.created_by<>uid then raise exception 'pr_forbidden';end if;
  if c.deleted_at is not null or exists(select 1 from public.production_live_runs where id=c.run_id and deleted_at is not null) then raise exception 'pl_report_deleted';end if;
  return to_jsonb(c);
 end if;
 if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
 v_quantity:=(p_data->>'quantity')::bigint;
 select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
 if r.id is null then
  v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=coalesce((p_data->>'shift_hours')::integer,8);
  if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  if v_start is null or v_start>=v_now or v_start<v_now-interval '24 hours' or v_hours not in(8,10) then raise exception 'pl_start_invalid';end if;
  select * into t from public.production_targets where item_id=v_item and deleted_at is null;
  if t.item_id is null then raise exception 'pl_target_missing';end if;
  v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
  perform pg_advisory_xact_lock(hashtextextended(v_station,1));
  v_session:=coalesce((p_data->>'session_id')::uuid,(p_data->>'run_id')::uuid);
  if exists(select 1 from public.production_live_runs x where x.session_id=v_session and (x.created_by<>uid or x.station_code<>v_station or x.started_at<>v_start or x.shift_hours<>v_hours or x.closed_at is not null or x.deleted_at is not null)) then raise exception 'pr_forbidden';end if;
  if exists(select 1 from public.production_live_runs where station_code=v_station and (session_id<>v_session or item_id=v_item) and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
  insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
  values((p_data->>'run_id')::uuid,v_session,v_station,v_item,v_start,uid,v_target/v_hours,2,t.warning_percent,t.critical_percent,v_hours,v_target) returning * into r;
 else
  if r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if v_now>r.started_at+interval '24 hours' then raise exception 'pl_expired';end if;
  if v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
 end if;
 insert into public.production_checkpoints(id,run_id,recorded_at,quantity,created_by,expected_quantity,attainment,performance)
 values(v_id,r.id,v_now,v_quantity,uid,1,0,'on_track') returning * into c;
 perform rls_internal.production_live_recalculate(r.id);
 select * into c from public.production_checkpoints where id=v_id;
 return to_jsonb(c);
end $function$;