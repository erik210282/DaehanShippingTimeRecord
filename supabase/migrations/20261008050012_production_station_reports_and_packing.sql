
-- Manufacturing ingredients and packing materials have separate consumption bases.
create table public.inventory_bom_packaging (
 bom_id uuid not null references public.inventory_boms(id) on delete cascade,
 packaging_type text not null check(packaging_type in ('returnable','expendable')),
 pieces_per_box integer not null check(pieces_per_box>0),
 box_name text not null default '',
 primary key(bom_id,packaging_type)
);
create table public.inventory_bom_packaging_lines (
 id uuid primary key default gen_random_uuid(),
 bom_id uuid not null,
 packaging_type text not null,
 ingredient_id uuid not null references public.inventory_items(id),
 quantity numeric not null check(quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')),
 basis text not null check(basis in ('piece','box','pallet')),
 waste_rate numeric not null default 0 check(waste_rate>=0 and waste_rate<1),
 foreign key(bom_id,packaging_type) references public.inventory_bom_packaging(bom_id,packaging_type) on delete cascade,
 unique(bom_id,packaging_type,ingredient_id,basis)
);
create table public.production_station_reports (
 id uuid primary key,
 station_code text not null references public.inventory_workstations(code),
 item_id uuid not null references public.inventory_items(id),
 bom_id uuid references public.inventory_boms(id),
 production_date date not null,
 start_time time not null,
 end_time time not null,
 ends_next_day boolean not null default false,
 elapsed_minutes numeric not null check(elapsed_minutes>0 and elapsed_minutes<=1440),
 machine_minutes numeric not null check(machine_minutes>=0),
 downtime_minutes numeric not null default 0 check(downtime_minutes>=0),
 downtime_reason text not null default '',
 break_count integer not null default 0 check(break_count>=0),
 break_minutes numeric not null default 0 check(break_minutes>=0),
 people integer not null check(people>0),
 machine_quantity integer not null default 0 check(machine_quantity>=0),
 scrap_quantity integer not null default 0 check(scrap_quantity>=0),
 rework_quantity integer not null default 0 check(rework_quantity>=0),
 good_quantity integer generated always as (machine_quantity-scrap_quantity-rework_quantity) stored,
 packaging_type text check(packaging_type in ('returnable','expendable')),
 full_boxes integer not null default 0 check(full_boxes>=0),
 pallets integer not null default 0 check(pallets>=0),
 pieces_per_box integer not null default 0 check(pieces_per_box>=0),
 packed_quantity integer generated always as (full_boxes*pieces_per_box) stored,
 turns integer check(turns>=0),
 report_mode text not null default 'production' check(report_mode in ('production','packing')),
 note text not null default '',
 status text not null default 'draft' check(status in ('draft','submitted','posted')),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 inventory_report_id uuid unique references public.inventory_production_reports(id),
 check(scrap_quantity+rework_quantity<=machine_quantity),
 check(full_boxes*pieces_per_box<=machine_quantity-scrap_quantity-rework_quantity),
 check(machine_minutes+downtime_minutes+break_minutes<=elapsed_minutes),
 check((break_count=0 and break_minutes=0) or (break_count>0 and break_minutes>0)),
 check(full_boxes=0 or (packaging_type is not null and pieces_per_box>0)),
 check(pallets=0 or full_boxes>0)
);
create index production_station_reports_date_idx on public.production_station_reports(production_date desc,station_code);
create index production_station_reports_item_idx on public.production_station_reports(item_id);
create index production_station_reports_bom_idx on public.production_station_reports(bom_id);
create index production_station_reports_creator_idx on public.production_station_reports(created_by);
create table public.production_station_consumptions (
 report_id uuid not null references public.production_station_reports(id),
 ingredient_id uuid not null references public.inventory_items(id),
 area text not null check(area in ('RAW','WIP','FG','PACKAGING')),
 source text not null check(source in ('manufacturing','packing','repack','wip')),
 quantity numeric not null check(quantity>0),
 primary key(report_id,ingredient_id,area,source)
);
create index production_station_consumptions_item_idx on public.production_station_consumptions(ingredient_id);
create index inventory_bom_packaging_lines_item_idx on public.inventory_bom_packaging_lines(ingredient_id);

alter table public.inventory_bom_packaging enable row level security;
alter table public.inventory_bom_packaging_lines enable row level security;
alter table public.production_station_reports enable row level security;
alter table public.production_station_consumptions enable row level security;
revoke all on public.inventory_bom_packaging,public.inventory_bom_packaging_lines,public.production_station_reports,public.production_station_consumptions from public,anon,authenticated;
grant select on public.inventory_bom_packaging,public.inventory_bom_packaging_lines,public.production_station_reports,public.production_station_consumptions to authenticated;
create policy bom_packaging_read on public.inventory_bom_packaging for select to authenticated using(rls_internal.catalog_access());
create policy bom_packaging_lines_read on public.inventory_bom_packaging_lines for select to authenticated using(rls_internal.catalog_access());
create policy station_report_read on public.production_station_reports for select to authenticated using(public.inventory_access('production') or public.inventory_access('inventory',true));
create policy station_consumption_read on public.production_station_consumptions for select to authenticated using(public.inventory_access('production') or public.inventory_access('inventory',true));

create or replace function rls_internal.inventory_catalog_recipe(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
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
   insert into public.inventory_bom_packaging(bom_id,packaging_type,pieces_per_box,box_name) values(v_id,v_pack->>'packaging_type',(v_pack->>'pieces_per_box')::integer,btrim(v_pack->>'box_name'));
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
end $$;

create or replace function rls_internal.production_station_action(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
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
end $$;
create function public.production_station_action(p_action text,p_data jsonb) returns uuid language sql security invoker set search_path='' as $$select rls_internal.production_station_action($1,$2);$$;
revoke all on function rls_internal.production_station_action(text,jsonb) from public,anon;
revoke all on function public.production_station_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_station_action(text,jsonb),public.production_station_action(text,jsonb) to authenticated;
-- Inventory postings are server transactions; clients can only read their results.
do $$declare v_table text;begin foreach v_table in array array['inventory_bom_packaging','inventory_bom_packaging_lines','production_station_reports','production_station_consumptions'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then execute format('alter publication supabase_realtime add table public.%I',v_table);end if;end loop;end$$;
notify pgrst,'reload schema';
