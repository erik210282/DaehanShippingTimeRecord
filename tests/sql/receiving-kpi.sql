begin;
do $qa$
declare actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid(); raw uuid:=gen_random_uuid(); fg uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); line uuid:=gen_random_uuid(); place1 uuid:=gen_random_uuid(); place2 uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); result jsonb; body jsonb; denied boolean; task uuid; stage text; qty numeric; station text:='QA-KPI-'||left(gen_random_uuid()::text,8);
begin
 insert into auth.users(id) values(actor),(outsider);
 insert into public.operadores(id,uid,nombre,activo,role) values(actor,actor,'QA KPI Admin',true,'supervisor'),(outsider,outsider,'QA Outsider',true,'operador');
 insert into public.global_system_admins(user_id) values(actor);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.receiving_suppliers(id,code,name) values(supplier,'QA-'||supplier,'QA Supplier');
 insert into public.receiving_locations(id,code,name,kind) values(place1,'QA-'||place1,'QA One','STORAGE'),(place2,'QA-'||place2,'QA Two','STORAGE');
 insert into public.inventory_items(id,part_number,category) values(raw,'QA-RAW-'||raw,'RAW'),(fg,'QA-FG-'||fg,'FG');
 perform public.receiving_start(receipt,jsonb_build_object('supplier_id',supplier,'manifest','QA Unknown Load','trailer','qa trailer','dock','1'));
 if exists(select 1 from public.receiving_lines where receipt_id=receipt) then raise exception 'Unknown trailer created phantom parts';end if;
 perform public.receiving_task_group(receipt,'pause');perform public.receiving_task_group(receipt,'resume');perform public.receiving_task_group(receipt,'finish');
 if not exists(select 1 from public.receiving_receipts where id=receipt and status='received') then raise exception 'Unknown trailer not finished';end if;
 body:=jsonb_build_array(jsonb_build_object('id',line,'item_id',raw,'received',100,'lot','QA'));
 result:=public.receiving_identify(req,receipt,0,body);perform public.receiving_identify(req,receipt,0,body);
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw)<>100 then raise exception 'Receipt posted twice';end if;
 denied:=false;begin perform public.receiving_identify(gen_random_uuid(),receipt,0,body);exception when others then if sqlerrm<>'rx_changed' then raise;end if;denied:=true;end;if not denied then raise exception 'Stale receipt version accepted';end if;
 body:=jsonb_build_array(jsonb_build_object('location_id',place1,'quantity',40),jsonb_build_object('location_id',place2,'quantity',60));
 result:=public.receiving_putaway_batch(batch,line,body,'[]');perform public.receiving_putaway_batch(batch,line,body,'[]');
 if jsonb_array_length(result)<>2 or (select count(*) from public.receiving_tasks where putaway_group_id=batch)<>2 then raise exception 'Split tasks not idempotent';end if;
 task:=(result->>0)::uuid;perform public.receiving_task_group(task,'pause');
 if exists(select 1 from public.receiving_tasks where putaway_group_id=batch and status<>'paused') then raise exception 'Group pause incomplete';end if;
 perform public.receiving_task_group(task,'resume');perform public.receiving_task_group(task,'finish');perform public.receiving_task_group(task,'finish');
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw)<>100 then raise exception 'Putaway received inventory twice';end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw and location='QA-'||place1)<>40 or (select sum(quantity_delta) from public.inventory_movements where item_id=raw and location='QA-'||place2)<>60 then raise exception 'Location allocations incorrect';end if;
 if not exists(select 1 from public.receiving_line_status where id=line and available_to_store=0 and stored=100) then raise exception 'Reservation balance incorrect';end if;
 denied:=false;begin perform public.receiving_putaway_batch(gen_random_uuid(),line,jsonb_build_array(jsonb_build_object('location_id',place1,'quantity',1)),'[]');exception when others then if sqlerrm<>'receiving_quantity' then raise;end if;denied:=true;end;if not denied then raise exception 'Oversubscribed receipt';end if;
 -- Edits cannot reduce already stored stock. Identifying more material receives only the difference.
 denied:=false;begin perform public.receiving_identify(gen_random_uuid(),receipt,1,jsonb_build_array(jsonb_build_object('id',line,'item_id',raw,'received',99)));exception when others then if sqlerrm<>'receiving_quantity' then raise;end if;denied:=true;end;if not denied then raise exception 'Stored stock reduced';end if;
 perform public.receiving_identify(gen_random_uuid(),receipt,1,jsonb_build_array(jsonb_build_object('id',line,'item_id',raw,'received',120)));
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw)<>120 then raise exception 'Correction did not receive delta only';end if;
 -- A failing allocation request is atomic.
 denied:=false;begin perform public.receiving_putaway_batch(gen_random_uuid(),line,jsonb_build_array(jsonb_build_object('location_id',place1,'quantity',10),jsonb_build_object('location_id',place2,'quantity',11)),'[]');exception when others then if sqlerrm<>'receiving_quantity' then raise;end if;denied:=true;end;if not denied then raise exception 'Invalid split accepted';end if;
 insert into public.inventory_workstations(code,name,machine_type) values(station,'QA Assembly','Assembly');
 insert into public.production_station_reports(id,station_code,item_id,production_date,start_time,end_time,elapsed_minutes,machine_minutes,downtime_minutes,people,machine_quantity,scrap_quantity,status,created_by) values(gen_random_uuid(),station,fg,date '2026-10-20','06:00','08:00',120,90,20,2,100,5,'submitted',actor);
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,effective_date,created_by) values(fg,'FG',500,'OPENING','qa-kpi-open:'||fg,date '2026-10-19',actor),(fg,'FG',-10,'SHIPMENT','qa-kpi-ship:'||fg,date '2026-10-20',actor);
 result:=public.production_kpi_snapshot('2026-10-20','2026-10-21',array[fg]);
 if not result->'opening' @> jsonb_build_array(jsonb_build_object('item_id',fg,'quantity',500)) or not result->'movements' @> jsonb_build_array(jsonb_build_object('kind','SHIPMENT','quantity',-10)) then raise exception 'KPI stock context incorrect';end if;
 if jsonb_array_length(result->'reports')<>1 then raise exception 'KPI daily sources incorrect';end if;
 set local role authenticated;
 result:=public.production_kpi_snapshot('2026-10-20','2026-10-21',array[fg]);
 reset role;
 perform public.save_role_access('production','lider',(select activities from public.global_role_access_profiles where department='production' and role='lider'),(select version from public.global_role_access_profiles where department='production' and role='lider'));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 denied:=false;begin perform public.receiving_identify(gen_random_uuid(),receipt,2,'[]');exception when others then if sqlerrm<>'receiving_forbidden' then raise;end if;denied:=true;end;if not denied then raise exception 'Foreign department edited receipt';end if;
 denied:=false;begin perform public.production_kpi_snapshot('2026-10-20','2026-10-21',array[fg]);exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;denied:=true;end;if not denied then raise exception 'Foreign department accessed KPI';end if;
 perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.production_kpi_items();exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;denied:=true;end;if not denied then raise exception 'Anonymous KPI allowed';end if;
 if has_function_privilege('anon','public.receiving_identify(uuid,uuid,integer,jsonb)','execute') or has_function_privilege('anon','public.production_kpi_snapshot(date,date,uuid[])','execute') then raise exception 'Anonymous RPC permission';end if;
end $qa$;

rollback;
