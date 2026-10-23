-- Run after the two catalog migrations inside a transaction, then roll back.
do $qa$
declare caller uuid; input_category text; output_category text; input_id uuid; output_id uuid; bad_id uuid:=gen_random_uuid(); recipe uuid; station text; report uuid; snapshot jsonb; payload jsonb;
begin
 select a.user_id into caller from public.global_system_admins a join public.operadores o on o.uid=a.user_id where o.activo limit 1;
 if caller is null then raise exception 'Active admin required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',caller,'role','authenticated')::text,true);
 insert into public.inventory_items(id,part_number,category,active) values(bad_id,'QA-PACK-'||bad_id,'PACKAGING',true);
 foreach input_category in array array['RAW','SEMI'] loop
  foreach output_category in array array['SEMI','FG'] loop
   input_id:=gen_random_uuid();output_id:=gen_random_uuid();recipe:=gen_random_uuid();report:=gen_random_uuid();station:='QA-FLOW-'||left(gen_random_uuid()::text,8);
   insert into public.inventory_items(id,part_number,category,active) values(input_id,'QA-IN-'||input_id,input_category,true),(output_id,'QA-OUT-'||output_id,output_category,true);
   insert into public.inventory_workstations(code,name,machine_type,raw_material_ids,materials)
    select station,'QA '||input_category||' -> '||output_category,name,array[input_id],jsonb_build_array(jsonb_build_object('erp_material','QA-ERP','product','QA Output','item_id',output_id)) from public.machine_types where active limit 1;
   begin update public.inventory_workstations set raw_material_ids=array[output_id] where code=station and output_category='FG';if found then raise exception 'FG accepted as input';end if;exception when others then if sqlerrm<>'dt_raw_invalid' then raise;end if;end;
   begin update public.inventory_workstations set raw_material_ids=array[bad_id] where code=station;raise exception 'Packaging accepted as input';exception when others then if sqlerrm<>'dt_raw_invalid' then raise;end if;end;
   if input_category='RAW' then
    begin update public.inventory_workstations set materials=jsonb_build_array(jsonb_build_object('erp_material','QA','product','QA','item_id',input_id)) where code=station;raise exception 'RAW accepted as output';exception when others then if sqlerrm<>'dt_output_invalid' then raise;end if;end;
    begin update public.inventory_workstations set materials=jsonb_build_array(jsonb_build_object('item_ids',jsonb_build_array(input_id))) where code=station;raise exception 'RAW output array accepted';exception when others then if sqlerrm<>'dt_output_invalid' then raise;end if;end;
   end if;
   insert into public.inventory_boms(id,finished_item_id,version,active) values(recipe,output_id,1,true);
   insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(recipe,input_id,2);
   perform public.production_supply_action('load',jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',input_id,'quantity',100));
   if exists(select 1 from public.inventory_movements where item_id=input_id) then raise exception 'Loading consumed inventory';end if;
   if not exists(select 1 from rls_internal.production_station_raw_ids(station) where item_id=input_id) then raise exception 'Assigned input hidden';end if;
   payload:=jsonb_build_object('id',report,'station_code',station,'item_id',output_id,'production_date',current_date-1,'start_time','06:00','end_time','07:00','ends_next_day',false,'people',2,'report_mode','production','machine_quantity',10,'scrap_quantity',0,'rework_quantity',0,'rework_completed',true,'full_boxes',0,'pallets',0,'break_minutes',0,'break_count',0,'downtime_minutes',0,'machine_minutes',60,'downtime_events','[]'::jsonb,'note','QA input/output');
   perform public.production_station_action('submit',payload);
   perform public.production_station_action('post',jsonb_build_object('id',report));
   insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
    values(gen_random_uuid(),gen_random_uuid(),station,output_id,now()-interval '1 hour',caller,100,2,90,75,8,750);
   if not exists(select 1 from public.production_station_consumptions where report_id=report and ingredient_id=input_id and quantity=20 and area=case when input_category='SEMI' then 'WIP' else 'RAW' end) then raise exception 'Incorrect % -> % consumption',input_category,output_category;end if;
   snapshot:=public.production_supply_snapshot();
   if not exists(select 1 from jsonb_array_elements(snapshot->'materials') m where m->>'station_code'=station and (m->>'confirmed_consumption')::numeric=20) then raise exception 'Confirmed input tracking missing for %',input_category;end if;
   if not exists(select 1 from jsonb_array_elements(snapshot->'runs') r cross join lateral jsonb_array_elements(r->'raw_recipe') ingredient where r->>'station_code'=station and ingredient->>'item_id'=input_id::text and (ingredient->>'per_unit')::numeric=2) then raise exception 'Input recipe missing from forecast for %',input_category;end if;
  end loop;
 end loop;
end $qa$;
select 'PASS RAW/SEMI -> SEMI/FG, station assignments, RAW/packaging rejection, no inventory change on loading, correct RAW/WIP consumption and confirmed tracking' result;
