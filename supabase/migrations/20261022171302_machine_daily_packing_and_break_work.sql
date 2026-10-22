-- Machine daily reports, mixed packing and work performed during fixed breaks.
alter table public.production_station_reports
 add column packing_breakdown jsonb not null default '[]' check(jsonb_typeof(packing_breakdown)='array'),
 add column packing_pieces integer check(packing_pieces>=0),
 add column break_work jsonb not null default '[]' check(jsonb_typeof(break_work)='array'),
 add column machine_session_id uuid;
alter table public.production_station_reports alter column packed_quantity set expression as (coalesce(packing_pieces,full_boxes*pieces_per_box));
alter table public.production_station_reports drop constraint production_station_reports_packed_check;
alter table public.production_station_reports add constraint production_station_reports_packed_check check(packed_quantity<=good_quantity);
create index production_daily_machine_session on public.production_station_reports(machine_session_id,production_date,station_code) where machine_session_id is not null;
update public.production_station_reports r set machine_session_id=coalesce(l.session_id,l.id) from public.production_live_runs l where l.id=r.live_run_id;
create function rls_internal.production_stamp_daily_session() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.live_run_id is not null then select coalesce(session_id,id) into new.machine_session_id from public.production_live_runs where id=new.live_run_id;end if;
 return new;
end $$;
revoke all on function rls_internal.production_stamp_daily_session() from public,anon,authenticated;
create trigger production_stamp_daily_session before insert or update of live_run_id on public.production_station_reports for each row execute function rls_internal.production_stamp_daily_session();

create function rls_internal.production_daily_packing(p_rows jsonb,p_bom uuid,p_item uuid,p_catalog boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb; profile public.inventory_bom_packaging;result jsonb:='[]';box_count integer;capacity integer;pal integer;catalog jsonb;piece_count integer;box_name text;packing_item uuid;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10 then raise exception 'dx_packing_invalid';end if;
 if (select count(distinct value->>'packaging_type') from jsonb_array_elements(p_rows) where coalesce(value->>'packaging_type','')<>'')<>(select count(*) from jsonb_array_elements(p_rows) where coalesce(value->>'packaging_type','')<>'') then raise exception 'dx_packing_invalid';end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if coalesce(row->>'full_boxes','')!~'^\d{1,9}$' then raise exception 'dx_packing_invalid';end if;box_count:=(row->>'full_boxes')::integer;
  if box_count=0 and coalesce(row->>'packaging_type','')='' then continue;end if;
  select * into profile from public.inventory_bom_packaging where bom_id=p_bom and packaging_type=row->>'packaging_type' for share;
  if not found then raise exception 'pr_pack_missing';end if;
  piece_count:=profile.pieces_per_box;box_name:=profile.box_name;packing_item:=null;
  if p_catalog then
   catalog:=rls_internal.production_packing_profile(p_item,profile.packaging_type,p_bom);
   if catalog is null then raise exception 'pr_pack_catalog_required';end if;
   piece_count:=(catalog->>'pieces_per_box')::integer;box_name:=catalog->>'box_name';packing_item:=(catalog->>'packing_item_id')::uuid;
  end if;
  pal:=0;
  if box_count>0 and exists(select 1 from public.inventory_bom_packaging_lines where bom_id=p_bom and packaging_type=profile.packaging_type and basis='pallet') then
   capacity:=profile.boxes_per_pallet;if capacity is null or capacity<=0 then raise exception 'pr_pallet_capacity';end if;
   pal:=ceil(box_count::numeric/capacity)::integer;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('packaging_type',profile.packaging_type,'full_boxes',box_count,'pieces_per_box',piece_count,'pallets',pal,'box_name',box_name,'packing_item_id',packing_item));
 end loop;
 return result;
end $$;
revoke all on function rls_internal.production_daily_packing(jsonb,uuid,uuid,boolean) from public,anon,authenticated;

create function rls_internal.production_break_work(p_rows jsonb,p_break_minutes numeric)
returns jsonb language plpgsql immutable set search_path='' as $$
declare row jsonb;minutes numeric;people integer;total numeric:=0;result jsonb:='[]';
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>30 then raise exception 'dx_extra_invalid';end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if coalesce(row->>'minutes','')!~'^\d{1,4}(\.\d{1,3})?$' or coalesce(row->>'people','')!~'^\d{1,4}$' then raise exception 'dx_extra_invalid';end if;
  minutes:=(row->>'minutes')::numeric;people:=(row->>'people')::integer;
  if minutes<=0 or minutes>1440 or people<1 or people>1000 then raise exception 'dx_extra_invalid';end if;
  total:=total+minutes;result:=result||jsonb_build_array(jsonb_build_object('minutes',minutes,'people',people));
 end loop;
 if total>coalesce(p_break_minutes,0) then raise exception 'dx_extra_invalid';end if;
 return result;
end $$;
revoke all on function rls_internal.production_break_work(jsonb,numeric) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION rls_internal.production_station_action_supply_base(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=(p_data->>'id')::uuid;v_old public.production_station_reports%rowtype;v_report public.production_station_reports%rowtype;v_station public.inventory_workstations%rowtype;v_item public.inventory_items%rowtype;v_bom public.inventory_boms%rowtype;v_profile public.inventory_bom_packaging%rowtype;v_row record;v_elapsed numeric;v_repack boolean;v_ledger uuid;v_qty numeric;v_balance numeric;v_can_manage boolean;v_packing jsonb;v_good integer;v_line jsonb;v_lines jsonb;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if v_id is null then raise exception 'pr_invalid';end if;
 v_can_manage:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 perform pg_advisory_xact_lock(hashtextextended('station-report:'||v_id,0));
 select * into v_old from public.production_station_reports where id=v_id for update;
 if v_old.id is not null and v_old.created_by<>auth.uid() and not v_can_manage and p_action not in ('save','submit') then raise exception 'pr_forbidden';end if;
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
  v_report.packing_breakdown:=coalesce(p_data->'packing_breakdown','[]');
  v_report.break_work:=coalesce(p_data->'break_work','[]');
  if jsonb_array_length(v_report.packing_breakdown)>0 then
   v_report.packing_breakdown:=rls_internal.production_daily_packing(v_report.packing_breakdown,v_bom.id,v_item.id,v_report.catalog_packing);
   select coalesce(sum((x->>'full_boxes')::integer),0),coalesce(sum((x->>'full_boxes')::integer*(x->>'pieces_per_box')::integer),0),coalesce(sum((x->>'pallets')::integer),0) into v_report.full_boxes,v_report.packing_pieces,v_report.pallets from jsonb_array_elements(v_report.packing_breakdown)x;
   v_report.packaging_type:=v_report.packing_breakdown->0->>'packaging_type';
   v_report.pieces_per_box:=coalesce((v_report.packing_breakdown->0->>'pieces_per_box')::integer,0);
   select string_agg((x->>'box_name')||' × '||(x->>'full_boxes'),' / ') into v_report.packing_box_name from jsonb_array_elements(v_report.packing_breakdown)x;
   if v_report.packing_pieces>v_good then raise exception 'pr_quantity_invalid';end if;
  elsif v_report.full_boxes>0 then
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
   if exists(select 1 from public.production_station_reports r where r.id<>v_id and (v_report.capture_group_id is null or r.capture_group_id is distinct from v_report.capture_group_id) and r.station_code=v_station.code and (v_report.machine_session_id is null or r.machine_session_id is distinct from v_report.machine_session_id) and r.status in ('submitted','posted') and not exists(select 1 from public.production_live_runs a join public.production_live_runs b on b.session_id=a.session_id and b.item_id<>a.item_id where a.id=v_report.live_run_id and b.id=r.live_run_id) and tsrange(r.production_date+r.start_time,r.production_date+r.end_time+case when r.ends_next_day then interval '1 day' else interval '0' end,'[)') && tsrange(v_report.production_date+v_report.start_time,v_report.production_date+v_report.end_time+case when v_report.ends_next_day then interval '1 day' else interval '0' end,'[)')) then raise exception 'pr_overlap';end if;
  end if;
  insert into public.production_station_reports(id,capture_group_id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,downtime_reason,break_count,break_minutes,people,machine_quantity,scrap_quantity,rework_quantity,packaging_type,full_boxes,pallets,pieces_per_box,turns,report_mode,note,status,created_by,rework_completed,catalog_packing,packing_item_id,packing_box_name,packing_breakdown,packing_pieces,break_work)
  values(v_id,v_report.capture_group_id,v_station.code,v_item.id,v_bom.id,v_report.production_date,v_report.start_time,v_report.end_time,v_report.ends_next_day,v_elapsed,v_report.machine_minutes,v_report.downtime_minutes,coalesce(v_report.downtime_reason,''),v_report.break_count,v_report.break_minutes,v_report.people,v_report.machine_quantity,v_report.scrap_quantity,v_report.rework_quantity,v_report.packaging_type,v_report.full_boxes,v_report.pallets,v_report.pieces_per_box,v_report.turns,v_report.report_mode,coalesce(v_report.note,''),case when p_action='submit' then 'submitted' else 'draft' end,coalesce(v_old.created_by,auth.uid()),v_report.rework_completed,v_report.catalog_packing,v_report.packing_item_id,v_report.packing_box_name,v_report.packing_breakdown,v_report.packing_pieces,v_report.break_work)
  on conflict(id) do update set packing_breakdown=excluded.packing_breakdown,packing_pieces=excluded.packing_pieces,break_work=excluded.break_work,capture_group_id=excluded.capture_group_id,rework_completed=excluded.rework_completed,catalog_packing=excluded.catalog_packing,packing_item_id=excluded.packing_item_id,packing_box_name=excluded.packing_box_name,station_code=excluded.station_code,item_id=excluded.item_id,bom_id=excluded.bom_id,production_date=excluded.production_date,start_time=excluded.start_time,end_time=excluded.end_time,ends_next_day=excluded.ends_next_day,elapsed_minutes=excluded.elapsed_minutes,machine_minutes=excluded.machine_minutes,downtime_minutes=excluded.downtime_minutes,downtime_reason=excluded.downtime_reason,break_count=excluded.break_count,break_minutes=excluded.break_minutes,people=excluded.people,machine_quantity=excluded.machine_quantity,scrap_quantity=excluded.scrap_quantity,rework_quantity=excluded.rework_quantity,packaging_type=excluded.packaging_type,full_boxes=excluded.full_boxes,pallets=excluded.pallets,pieces_per_box=excluded.pieces_per_box,turns=excluded.turns,report_mode=excluded.report_mode,note=excluded.note,status=excluded.status,updated_at=now();
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
 if jsonb_array_length(v_old.packing_breakdown)>0 then
  v_lines:=rls_internal.production_daily_packing(v_old.packing_breakdown,v_bom.id,v_item.id,v_old.catalog_packing);
  if v_lines is distinct from v_old.packing_breakdown or v_old.packed_quantity is distinct from (select coalesce(sum((x->>'full_boxes')::integer*(x->>'pieces_per_box')::integer),0) from jsonb_array_elements(v_lines)x) or v_old.full_boxes is distinct from (select coalesce(sum((x->>'full_boxes')::integer),0) from jsonb_array_elements(v_lines)x) or v_old.pallets is distinct from (select coalesce(sum((x->>'pallets')::integer),0) from jsonb_array_elements(v_lines)x) then raise exception 'pr_recipe_changed';end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
   if (v_line->>'full_boxes')::integer=0 then continue;end if;
   insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity)
    select v_id,ingredient_id,'PACKAGING','packing',sum(quantity*(1+waste_rate)*case basis when 'piece' then (v_line->>'full_boxes')::numeric*(v_line->>'pieces_per_box')::numeric when 'box' then (v_line->>'full_boxes')::numeric when 'pallet' then (v_line->>'pallets')::numeric end)
    from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_line->>'packaging_type' group by ingredient_id
    on conflict(report_id,ingredient_id,area,source) do update set quantity=production_station_consumptions.quantity+excluded.quantity;
   if nullif(v_line->>'packing_item_id','') is not null and not exists(select 1 from public.inventory_bom_packaging_lines where bom_id=v_bom.id and packaging_type=v_line->>'packaging_type' and ingredient_id=(v_line->>'packing_item_id')::uuid) then
    insert into public.production_station_consumptions(report_id,ingredient_id,area,source,quantity) values(v_id,(v_line->>'packing_item_id')::uuid,'PACKAGING','packing',(v_line->>'full_boxes')::numeric)
    on conflict(report_id,ingredient_id,area,source) do update set quantity=production_station_consumptions.quantity+excluded.quantity;
   end if;
  end loop;
  if v_old.full_boxes>0 and not exists(select 1 from public.production_station_consumptions where report_id=v_id and source='packing') then raise exception 'pr_pack_missing';end if;
 elsif v_old.full_boxes>0 then
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
  -- Production must be recorded even when the current stock is insufficient.
  -- Keep the consumption ledger and allow its balance to become negative.
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
end $function$
;

CREATE OR REPLACE FUNCTION rls_internal.production_station_action_duration_core(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result_id uuid;events jsonb;d jsonb;minutes numeric;total_stop numeric:=0;break_stop numeric:=0;breaks integer:=0;reason text:='';elapsed numeric;payload jsonb:=p_data;capacity integer;pallets integer:=0;profile public.inventory_bom_packaging%rowtype;extra_rows jsonb;extra_minutes numeric;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in ('save','submit') and p_data ? 'downtime_events' then
  perform pg_advisory_xact_lock(hashtextextended('station-report:'||(p_data->>'id'),0));
  events:=p_data->'downtime_events';
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>1000 then raise exception 'pr_downtime_invalid';end if;
  for d in select value from jsonb_array_elements(events) loop
   if d->>'type' is null or d->>'type' not in ('break','lunch','maintenance','breakdown','inactive') then raise exception 'pr_downtime_invalid';end if;
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
  extra_rows:=rls_internal.production_break_work(coalesce(p_data->'break_work','[]'),break_stop);
  select coalesce(sum((value->>'minutes')::numeric),0) into extra_minutes from jsonb_array_elements(extra_rows);
  payload:=p_data||jsonb_build_object('break_work',extra_rows,'machine_minutes',elapsed-total_stop+extra_minutes,'downtime_minutes',total_stop-break_stop,'break_count',case when break_stop=extra_minutes then 0 else breaks end,'break_minutes',break_stop-extra_minutes,'downtime_reason',reason,'pallets',pallets);
 end if;
 result_id:=rls_internal.production_station_action_core(p_action,payload);
 if p_action in ('save','submit') and p_data ? 'downtime_events' then update public.production_station_reports set downtime_events=events where id=result_id;end if;
 return result_id;
end $function$
;

alter function rls_internal.production_station_action(text,jsonb) rename to production_station_action_before_machine_daily;
revoke all on function rls_internal.production_station_action_before_machine_daily(text,jsonb) from public,anon,authenticated;
create function rls_internal.production_daily_single(p_action text,p_data jsonb,p_session uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare draft public.production_station_reports;canonical_session uuid;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in('save','submit') then
  select * into draft from public.production_station_reports where id=(p_data->>'id')::uuid;
  if draft.id is null and nullif(p_data->>'live_run_id','') is not null then select * into draft from public.production_station_reports where live_run_id=(p_data->>'live_run_id')::uuid and status='draft' and report_mode='production';end if;
  canonical_session:=coalesce(p_session,draft.machine_session_id);
  if canonical_session is null and coalesce(nullif(p_data->>'live_run_id','')::uuid,draft.live_run_id) is not null then select coalesce(session_id,id) into canonical_session from public.production_live_runs where id=coalesce(nullif(p_data->>'live_run_id','')::uuid,draft.live_run_id);end if;
  p_data:=(p_data-'machine_session_id')||jsonb_build_object('machine_session_id',canonical_session);
  if draft.id is not null then
   if not(p_data?'packing_breakdown') then p_data:=p_data||jsonb_build_object('packing_breakdown',draft.packing_breakdown);end if;
   if not(p_data?'break_work') then p_data:=p_data||jsonb_build_object('break_work',draft.break_work);end if;
  end if;
 end if;
 return rls_internal.production_station_action_before_machine_daily(p_action,p_data);
end $$;
revoke all on function rls_internal.production_daily_single(text,jsonb,uuid) from public,anon,authenticated;
create function rls_internal.production_station_action(p_action text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare entry jsonb;first_row jsonb;result uuid;session_id uuid;this_session uuid;draft public.production_station_reports;chosen_group uuid;ids uuid[]:=array[]::uuid[];
begin
 if auth.uid() is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','records') then raise exception 'pr_forbidden';end if;
 if p_action in('save','submit') and p_data?'products' then
  if jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 then raise exception 'pr_invalid';end if;
  first_row:=p_data->'products'->0;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') or (select count(distinct value->>'id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  chosen_group:=coalesce(nullif(p_data->>'capture_group_id','')::uuid,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended('daily-machine:'||(first_row->>'station_code'),0));
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   if entry->>'station_code' is distinct from first_row->>'station_code' or entry->>'production_date' is distinct from first_row->>'production_date' then raise exception 'pr_invalid';end if;
   if nullif(entry->>'live_run_id','') is not null then
    select coalesce(r.session_id,r.id) into this_session from public.production_live_runs r where r.id=(entry->>'live_run_id')::uuid and r.deleted_at is null;
    if this_session is null or session_id is not null and session_id<>this_session then raise exception 'pr_invalid';end if;
    session_id:=this_session;
   end if;
  end loop;
  session_id:=coalesce(session_id,nullif(p_data->>'machine_session_id','')::uuid,chosen_group);
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   result:=rls_internal.production_daily_single(p_action,entry-'products',session_id);
   update public.production_station_reports set machine_session_id=session_id,capture_group_id=coalesce(capture_group_id,chosen_group) where id=result;
  end loop;
  return chosen_group;
 end if;
 return rls_internal.production_daily_single(p_action,p_data,null);
end $$;
revoke all on function rls_internal.production_station_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_station_action(text,jsonb) to authenticated;
create or replace function public.production_station_action(p_action text,p_data jsonb) returns uuid language sql set search_path='' as $$select rls_internal.production_station_action($1,$2);$$;
revoke all on function public.production_station_action(text,jsonb) from public,anon;
grant execute on function public.production_station_action(text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION rls_internal.production_daily_print_context(p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare anchor public.production_station_reports; result jsonb;
begin
 if auth.uid() is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','records') then raise exception 'pr_forbidden';end if;
 if not exists(select 1 from public.global_system_admins where user_id=auth.uid()) and not exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active and department='production' and role in ('lider','supervisor')) then raise exception 'pr_forbidden';end if;
 select * into anchor from public.production_station_reports where id=p_report;
 if not found then raise exception 'pr_invalid';end if;
 select jsonb_build_object(
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('part_number',i.part_number,'part_name',coalesce(i.part_name,i.description),'plan_quantity',coalesce(l.shift_target,case when r.elapsed_minutes>480 then t.target_10h else t.target_8h end))), '[]') from public.production_station_reports r join public.inventory_items i on i.id=r.item_id left join public.production_live_runs l on l.id=r.live_run_id left join public.production_targets t on t.item_id=r.item_id where r.id=anchor.id or (r.station_code=anchor.station_code and r.production_date=anchor.production_date and not r.progress_draft and ((anchor.machine_session_id is not null and r.machine_session_id=anchor.machine_session_id) or (anchor.capture_group_id is not null and r.capture_group_id=anchor.capture_group_id) or (anchor.live_run_id is not null and l.session_id=(select a.session_id from public.production_live_runs a where a.id=anchor.live_run_id))))),
 'station',(select to_jsonb(w) from public.inventory_workstations w where w.code=anchor.station_code),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',o.nombre,'role',m.role) order by o.nombre),'[]') from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and m.role in ('lider','supervisor') and o.activo),
 'author',(select jsonb_build_object('id',o.uid,'name',o.nombre,'role',(select m.role from public.global_department_memberships m where m.user_id=o.uid and m.department='production' and m.active limit 1)) from public.operadores o where o.uid=anchor.created_by),
 'codes',(select coalesce(jsonb_agg(to_jsonb(c) order by c.planned desc,c.code),'[]') from public.production_downtime_codes c where c.active)
 ) into result;
 return result;
end $function$

;
