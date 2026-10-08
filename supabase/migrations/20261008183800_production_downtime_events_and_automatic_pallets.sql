alter table public.inventory_bom_packaging add column boxes_per_pallet integer check(boxes_per_pallet>0);
alter table public.production_station_reports add column downtime_events jsonb check(downtime_events is null or jsonb_typeof(downtime_events)='array');

CREATE OR REPLACE FUNCTION rls_internal.inventory_catalog_recipe(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=nullif(p_data->>'id','')::uuid;v_part text;v_item uuid;v_version integer;v_line jsonb;v_qty numeric;v_waste numeric;v_active boolean;v_pack jsonb;v_ing public.inventory_items%rowtype;v_repack boolean:=false;
begin
 if auth.uid() is null or not rls_internal.catalog_access(true) then raise exception 'receiving_forbidden';end if;
 if p_action='delete' then
  perform 1 from public.inventory_boms where id=v_id for update;
  if not found then raise exception 'catalog_not_found';end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) or exists(select 1 from public.production_station_reports where bom_id=v_id) then
   update public.inventory_boms set active=false,archived=true where id=v_id;
  else delete from public.inventory_boms where id=v_id;end if;
  update public.catalog_updates set version=version+1;
  return v_id;
 end if;
 if p_action<>'save' then raise exception 'receiving_invalid';end if;
 v_part:=upper(btrim(p_data->>'product_part_number'));
 if v_part is null or v_part='' or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines')=0 then raise exception 'catalog_recipe_required';end if;
 select id into v_item from public.inventory_items where category in ('FG','SEMI') and part_number=v_part;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||v_part,0));
 if v_id is not null then
  perform 1 from public.inventory_boms where id=v_id and not archived for update;
  if not found then raise exception 'catalog_not_found';end if;
  if exists(select 1 from public.inventory_production_reports where bom_id=v_id) or exists(select 1 from public.production_station_reports where bom_id=v_id and status in ('submitted','posted')) then raise exception 'catalog_recipe_used';end if;
 end if;
 v_version:=nullif(p_data->>'version','')::integer;
 if v_version is null then select coalesce(max(version),0)+1 into v_version from public.inventory_boms where product_part_number=v_part;end if;
 if v_version<1 then raise exception 'receiving_invalid';end if;
 v_active:=coalesce((p_data->>'active')::boolean,true);
 -- The only FG ingredient allowed is this recipe's own output, alone and at 1:1.
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  select * into v_ing from public.inventory_items where id=(v_line->>'ingredient_id')::uuid and active;
  if not found or v_ing.category not in ('RAW','PACKAGING','SEMI','FG') then raise exception 'catalog_recipe_ingredient';end if;
  if v_ing.category='FG' then
   if v_ing.id is distinct from v_item or jsonb_array_length(p_data->'lines')<>1 or (v_line->>'quantity_per_unit')::numeric<>1 or coalesce((v_line->>'waste_rate')::numeric,0)<>0 then raise exception 'pr_repack_exclusive';end if;
   v_repack:=true;
  elsif v_ing.id=v_item then raise exception 'pr_repack_exclusive';end if;
 end loop;
 if v_active then update public.inventory_boms set active=false where product_part_number=v_part and active and id is distinct from v_id;end if;
 if v_id is null then
  insert into public.inventory_boms(finished_item_id,product_part_number,version,active,notes,created_by)
   values(v_item,v_part,v_version,v_active,nullif(p_data->>'notes',''),auth.uid()) returning id into v_id;
 else
  update public.inventory_boms set finished_item_id=v_item,product_part_number=v_part,version=v_version,active=v_active,notes=nullif(p_data->>'notes','') where id=v_id;
  delete from public.inventory_bom_lines where bom_id=v_id;
 end if;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  v_qty:=(v_line->>'quantity_per_unit')::numeric;v_waste:=coalesce((v_line->>'waste_rate')::numeric,0);
  if v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_waste<0 or v_waste>=1 or v_waste::text in ('NaN','Infinity','-Infinity') then raise exception 'receiving_quantity';end if;
  insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit,waste_rate) values(v_id,(v_line->>'ingredient_id')::uuid,v_qty,v_waste);
 end loop;
 if p_data ? 'packaging' then
  if jsonb_typeof(p_data->'packaging') is distinct from 'array' then raise exception 'pr_pack_invalid';end if;
  delete from public.inventory_bom_packaging where bom_id=v_id;
  for v_pack in select value from jsonb_array_elements(p_data->'packaging') loop
   if v_pack->>'packaging_type' not in ('returnable','expendable') or nullif(btrim(v_pack->>'box_name'),'') is null or coalesce((v_pack->>'pieces_per_box')::integer,0)<=0 or jsonb_typeof(v_pack->'lines') is distinct from 'array' or jsonb_array_length(v_pack->'lines')=0 then raise exception 'pr_pack_invalid';end if;
   if exists(select 1 from jsonb_array_elements(v_pack->'lines') l where l->>'basis'='pallet') and coalesce(nullif(v_pack->>'boxes_per_pallet','')::integer,0)<=0 then raise exception 'pr_pallet_capacity';end if;
   insert into public.inventory_bom_packaging(bom_id,packaging_type,pieces_per_box,box_name,boxes_per_pallet) values(v_id,v_pack->>'packaging_type',(v_pack->>'pieces_per_box')::integer,btrim(v_pack->>'box_name'),nullif(v_pack->>'boxes_per_pallet','')::integer);
   for v_line in select value from jsonb_array_elements(v_pack->'lines') loop
    v_qty:=(v_line->>'quantity')::numeric;v_waste:=coalesce((v_line->>'waste_rate')::numeric,0);
    if not exists(select 1 from public.inventory_items where id=(v_line->>'ingredient_id')::uuid and active and category='PACKAGING') or v_line->>'basis' not in ('piece','box','pallet') or v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_waste<0 or v_waste>=1 or v_waste::text in ('NaN','Infinity','-Infinity') then raise exception 'pr_pack_invalid';end if;
    if exists(select 1 from public.inventory_bom_lines where bom_id=v_id and ingredient_id=(v_line->>'ingredient_id')::uuid) then raise exception 'pr_pack_duplicate';end if;
    insert into public.inventory_bom_packaging_lines(bom_id,packaging_type,ingredient_id,quantity,basis,waste_rate)
     values(v_id,v_pack->>'packaging_type',(v_line->>'ingredient_id')::uuid,v_qty,v_line->>'basis',v_waste);
   end loop;
  end loop;
 end if;
 update public.catalog_updates set version=version+1;
 return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=(p_data->>'id')::uuid;v_old public.production_station_reports%rowtype;v_report public.production_station_reports%rowtype;v_station public.inventory_workstations%rowtype;v_item public.inventory_items%rowtype;v_bom public.inventory_boms%rowtype;v_profile public.inventory_bom_packaging%rowtype;v_row record;v_elapsed numeric;v_repack boolean;v_ledger uuid;v_qty numeric;v_balance numeric;v_can_manage boolean;
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
  v_elapsed:=extract(epoch from (v_report.end_time-v_report.start_time))/60+case when v_report.ends_next_day then 1440 else 0 end;
  if v_report.production_date is null or v_report.start_time is null or v_report.end_time is null or v_elapsed<=0 or v_elapsed>1440 or v_report.production_date>current_date+1 or v_report.people is null or v_report.people<=0 or v_report.machine_minutes is null or v_report.machine_minutes<0 or v_report.downtime_minutes is null or v_report.downtime_minutes<0 or v_report.break_minutes is null or v_report.break_minutes<0 or v_report.machine_minutes+v_report.downtime_minutes+v_report.break_minutes>v_elapsed or v_report.break_count is null or v_report.break_count<0 or (v_report.break_count=0)<>(v_report.break_minutes=0) or (v_report.downtime_minutes>0 and nullif(btrim(v_report.downtime_reason),'') is null) or v_report.report_mode not in ('production','packing') then raise exception 'pr_time_invalid';end if;
  if v_report.machine_quantity is null or v_report.scrap_quantity is null or v_report.rework_quantity is null or v_report.full_boxes is null or v_report.pallets is null or least(v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.full_boxes,v_report.pallets)<0 or v_report.scrap_quantity+v_report.rework_quantity>v_report.machine_quantity then raise exception 'pr_quantity_invalid';end if;
  if v_station.name ~* '(turn[ ]?table|t/t)' and (v_report.turns is null or v_report.turns<0) then raise exception 'pr_turns_required';end if;
  if v_report.full_boxes>0 then
   if v_item.category<>'FG' then raise exception 'pr_pack_invalid';end if;
   select * into v_profile from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_report.packaging_type;
   if not found then raise exception 'pr_pack_missing';end if;
   v_report.pieces_per_box:=v_profile.pieces_per_box;
   if v_report.full_boxes*v_profile.pieces_per_box>v_report.machine_quantity-v_report.scrap_quantity-v_report.rework_quantity then raise exception 'pr_quantity_invalid';end if;
   if exists(select 1 from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_profile.packaging_type and basis='pallet') and v_report.pallets<=0 then raise exception 'pr_pallets_required';end if;
  else v_report.pieces_per_box:=0;v_report.packaging_type:=null;if v_report.pallets<>0 then raise exception 'pr_quantity_invalid';end if;end if;
  if p_action='submit' then
   if v_bom.id is null or not exists(select 1 from public.inventory_bom_lines where bom_id=v_bom.id) then raise exception 'pr_recipe_missing';end if;
   if v_item.category not in ('FG','SEMI') then raise exception 'pr_output_required';end if;
   if exists(select 1 from public.production_station_reports r where r.id<>v_id and r.station_code=v_station.code and r.status in ('submitted','posted') and tsrange(r.production_date+r.start_time,r.production_date+r.end_time+case when r.ends_next_day then interval '1 day' else interval '0' end,'[)') && tsrange(v_report.production_date+v_report.start_time,v_report.production_date+v_report.end_time+case when v_report.ends_next_day then interval '1 day' else interval '0' end,'[)')) then raise exception 'pr_overlap';end if;
  end if;
  insert into public.production_station_reports(id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,downtime_reason,break_count,break_minutes,people,machine_quantity,scrap_quantity,rework_quantity,packaging_type,full_boxes,pallets,pieces_per_box,turns,report_mode,note,status,created_by)
  values(v_id,v_station.code,v_item.id,v_bom.id,v_report.production_date,v_report.start_time,v_report.end_time,v_report.ends_next_day,v_elapsed,v_report.machine_minutes,v_report.downtime_minutes,coalesce(v_report.downtime_reason,''),v_report.break_count,v_report.break_minutes,v_report.people,v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.packaging_type,v_report.full_boxes,v_report.pallets,v_report.pieces_per_box,v_report.turns,v_report.report_mode,coalesce(v_report.note,''),case when p_action='submit' then 'submitted' else 'draft' end,coalesce(v_old.created_by,auth.uid()))
  on conflict(id) do update set station_code=excluded.station_code,item_id=excluded.item_id,bom_id=excluded.bom_id,production_date=excluded.production_date,start_time=excluded.start_time,end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,downtime_reason=excluded.downtime_reason,break_count=excluded.break_count,break_minutes=excluded.break_minutes,people=excluded.people,machine_quantity=excluded.machine_quantity,scrap_quantity=excluded.scrap_quantity,rework_quantity=excluded.rework_quantity,packaging_type=excluded.packaging_type,full_boxes=excluded.full_boxes,pallets=excluded.pallets,pieces_per_box=excluded.pieces_per_box,turns=excluded.turns,report_mode=excluded.report_mode,note=excluded.note,status=excluded.status,updated_at=now();
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
  if not exists(select 1 from public.inventory_bom_packaging where bom_id=v_bom.id and packaging_type=v_old.packaging_type and pieces_per_box=v_old.pieces_per_box) then raise exception 'pr_recipe_changed';end if;
  insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
   select v_id,ingredient_id,'PACKAGING','packing',sum(quantity*(1+waste_rate)*case basis when 'piece' then v_old.packed_quantity when 'box' then v_old.full_boxes when 'pallet' then v_old.pallets end)
   from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_old.packaging_type group by ingredient_id;
  if not found then raise exception 'pr_pack_missing';end if;
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
   values(v_item.id,v_bom.id,v_old.production_date,v_old.good_quantity+v_old.rework_quantity,v_old.scrap_quantity,v_old.note,v_old.created_by) returning id into v_ledger;
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
end $function$
;
revoke all on function rls_internal.production_station_action_core(text,jsonb) from public,anon,authenticated;

create or replace function rls_internal.production_station_action(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $function$
declare result_id uuid;events jsonb;d jsonb;minutes numeric;total_stop numeric:=0;break_stop numeric:=0;breaks integer:=0;reason text:='';elapsed numeric;payload jsonb:=p_data;capacity integer;pallets integer:=0;profile public.inventory_bom_packaging%rowtype;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in ('save','submit') and p_data ? 'downtime_events' then
  perform pg_advisory_xact_lock(hashtextextended('station-report:'||(p_data->>'id'),0));
  events:=p_data->'downtime_events';
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>1000 then raise exception 'pr_downtime_invalid';end if;
  for d in select value from jsonb_array_elements(events) loop
   if d->>'type' is null or d->>'type' not in ('break','lunch','maintenance','breakdown') then raise exception 'pr_downtime_invalid';end if;
   minutes:=nullif(d->>'minutes','')::numeric;
   if minutes is null or minutes<=0 or minutes::text in ('NaN','Infinity','-Infinity') then raise exception 'pr_downtime_invalid';end if;
   total_stop:=total_stop+minutes;
   if d->>'type' in ('break','lunch') then break_stop:=break_stop+minutes;breaks:=breaks+1;
   else reason:=concat_ws('; ',nullif(reason,''),d->>'type'||case when coalesce(d->>'note','')<>'' then ': '||(d->>'note') else '' end);end if;
  end loop;
  elapsed:=extract(epoch from ((p_data->>'end_time')::time-(p_data->>'start_time')::time))/60+case when coalesce((p_data->>'ends_next_day')::boolean,false) then 1440 else 0 end;
  if elapsed is null or elapsed<=0 or elapsed>1440 or total_stop>elapsed then raise exception 'pr_time_invalid';end if;
  if coalesce((p_data->>'full_boxes')::integer,0)>0 then
   select p.* into profile from public.inventory_bom_packaging p join public.inventory_boms b on b.id=p.bom_id
    where b.finished_item_id=(p_data->>'item_id')::uuid and b.active and not b.archived and p.packaging_type=p_data->>'packaging_type' for share of b,p;
   if found and exists(select 1 from public.inventory_bom_packaging_lines l where l.bom_id=profile.bom_id and l.packaging_type=profile.packaging_type and l.basis='pallet') then
    capacity:=profile.boxes_per_pallet;
    if capacity is null or capacity<=0 then raise exception 'pr_pallet_capacity';end if;
    pallets:=ceil((p_data->>'full_boxes')::numeric/capacity)::integer;
   end if;
  end if;
  payload:=p_data||jsonb_build_object('machine_minutes',elapsed-total_stop,'downtime_minutes',total_stop-break_stop,'break_count',breaks,'break_minutes',break_stop,'downtime_reason',reason,'pallets',pallets);
 end if;
 result_id:=rls_internal.production_station_action_core(p_action,payload);
 if p_action in ('save','submit') and p_data ? 'downtime_events' then update public.production_station_reports set downtime_events=events where id=result_id;end if;
 return result_id;
end $function$;
notify pgrst,'reload schema';
