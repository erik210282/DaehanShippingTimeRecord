do $qa$
declare qa_user uuid;station text:='QA-DAILY-'||left(gen_random_uuid()::text,8);fg uuid:=gen_random_uuid();fg2 uuid:=gen_random_uuid();raw uuid:=gen_random_uuid();box_a uuid:=gen_random_uuid();box_b uuid:=gen_random_uuid();tape uuid:=gen_random_uuid();bom uuid:=gen_random_uuid();bom2 uuid:=gen_random_uuid();pack_a text:=gen_random_uuid()::text;pack_b text:=gen_random_uuid()::text;r1 uuid:=gen_random_uuid();r2 uuid:=gen_random_uuid();r3 uuid:=gen_random_uuid();session uuid:=gen_random_uuid();base jsonb;payload jsonb;products jsonb;stored public.production_station_reports;denied boolean;ctx jsonb;
begin
 select a.user_id into qa_user from public.global_system_admins a join public.operadores o on o.uid=a.user_id where o.activo limit 1;
 if qa_user is null then raise exception 'Missing active admin QA fixture';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_user,'role','authenticated')::text,true);
 insert into public.inventory_workstations(code,name,machine_type,active) values(station,'QA machine name','test',true);
 insert into public.inventory_items(id,part_number,category,active) values(fg,'QA-FG-'||fg,'FG',true),(fg2,'QA-SEMI-'||fg2,'SEMI',true),(raw,'QA-RAW-'||raw,'RAW',true),(box_a,'QA-BOX-'||box_a,'PACKAGING',true),(box_b,'QA-BOX-'||box_b,'PACKAGING',true),(tape,'QA-TAPE-'||tape,'PACKAGING',true);
 insert into public.inventory_boms(id,finished_item_id,version,active) values(bom,fg,1,true),(bom2,fg2,1,true);
 insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(bom,raw,2),(bom2,raw,1);
 insert into public.inventory_bom_packaging(bom_id,packaging_type,box_name,pieces_per_box) values(bom,pack_a,'Returnable QA',6),(bom,pack_b,'Expendable QA',10);
 insert into public.inventory_bom_packaging_lines(bom_id,packaging_type,ingredient_id,quantity,basis) values(bom,pack_a,box_a,1,'box'),(bom,pack_b,box_b,1,'box'),(bom,pack_a,tape,2,'box'),(bom,pack_b,tape,3,'box');
 base:=jsonb_build_object('station_code',station,'production_date',current_date-2,'start_time','06:00','end_time','14:00','ends_next_day',false,'people',2,'staff_names','QA One, QA Two','turns',null,'report_mode','production','machine_minutes',420,'downtime_minutes',0,'downtime_reason','','break_minutes',60,'break_count',3,'scrap_quantity',0,'rework_quantity',0,'rework_completed',true,'full_boxes',0,'pallets',0,'packaging_type',null,'catalog_packing',false,'note','','downtime_events','[]'::jsonb,'timezone','America/Los_Angeles');
 payload:=base||jsonb_build_object('id',r1,'item_id',fg,'machine_quantity',100,'full_boxes',5,'packaging_type',pack_a,'packing_breakdown',jsonb_build_array(jsonb_build_object('packaging_type',pack_a,'full_boxes',3,'pieces_per_box',999),jsonb_build_object('packaging_type',pack_b,'full_boxes',2)),'break_work',jsonb_build_array(jsonb_build_object('minutes',10,'people',1)));
 perform public.production_station_action('save',payload);
 select * into stored from public.production_station_reports where id=r1;
 if stored.packed_quantity<>38 or stored.full_boxes<>5 or stored.machine_minutes<>430 or stored.break_minutes<>50 or jsonb_array_length(stored.packing_breakdown)<>2 then raise exception 'Mixed save totals wrong %',to_jsonb(stored);end if;
 -- Reject exceeding good pieces, duplicate types and time exceeding fixed breaks.
 denied:=false;begin perform public.production_station_action('save',jsonb_set(payload,'{packing_breakdown,0,full_boxes}','99'));exception when others then if sqlerrm<>'pr_quantity_invalid' then raise;end if;denied:=true;end;if not denied then raise exception 'Overpacking accepted';end if;
 denied:=false;begin perform public.production_station_action('save',jsonb_set(payload,'{packing_breakdown,1,packaging_type}',to_jsonb(pack_a)));exception when others then if sqlerrm<>'dx_packing_invalid' then raise;end if;denied:=true;end;if not denied then raise exception 'Duplicate packing accepted';end if;
 denied:=false;begin perform public.production_station_action('save',jsonb_set(payload,'{break_work,0,minutes}','61'));exception when others then if sqlerrm<>'dx_extra_invalid' then raise;end if;denied:=true;end;if not denied then raise exception 'Extra exceeded breaks';end if;
 perform public.production_station_action('submit',payload);
 update public.production_station_reports set packing_pieces=39 where id=r1;denied:=false;begin perform public.production_station_action('post',jsonb_build_object('id',r1));exception when others then if sqlerrm<>'pr_recipe_changed' then raise;end if;denied:=true;end;if not denied then raise exception 'Inconsistent packed summary posted';end if;update public.production_station_reports set packing_pieces=38 where id=r1;
 perform public.production_station_action('post',jsonb_build_object('id',r1));perform public.production_station_action('post',jsonb_build_object('id',r1));
 if (select sum(quantity) from public.production_station_consumptions where report_id=r1 and ingredient_id=raw)<>200 or (select sum(quantity) from public.production_station_consumptions where report_id=r1 and ingredient_id=box_a)<>3 or (select sum(quantity) from public.production_station_consumptions where report_id=r1 and ingredient_id=box_b)<>2 or (select sum(quantity) from public.production_station_consumptions where report_id=r1 and ingredient_id=tape)<>12 then raise exception 'Wrong per-variant inventory consumption';end if;
 if (select sum(quantity_delta) from public.inventory_movements where reference_key='station-fg:'||r1)<>38 or (select sum(quantity_delta) from public.inventory_movements where reference_key='station-wip:'||r1)<>62 then raise exception 'FG/WIP output duplicated or wrong';end if;
 -- Caller-supplied session metadata cannot bypass an unrelated report overlap.
 denied:=false;
 begin perform public.production_station_action('submit',base||jsonb_build_object('id',gen_random_uuid(),'item_id',fg2,'machine_quantity',10,'machine_session_id',session));exception when others then if sqlerrm<>'pr_overlap' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Forged session bypassed overlap guard';end if;
 -- Former independently closed drafts can now be processed together, retaining distinct times.
 products:=jsonb_build_array(base||jsonb_build_object('id',r2,'item_id',fg,'machine_quantity',20,'production_date',current_date-1),base||jsonb_build_object('id',r3,'item_id',fg2,'machine_quantity',30,'production_date',current_date-1,'end_time','13:00'));
 perform public.production_station_action('save',products->0);perform public.production_station_action('save',products->1);
 update public.production_station_reports set capture_group_id=gen_random_uuid() where id in(r2,r3);
 perform public.production_station_action('submit',jsonb_build_object('capture_group_id',session,'products',products));
 if (select count(*) from public.production_station_reports where machine_session_id=session and status='submitted')<>2 then raise exception 'Independent draft batch failed';end if;
 if (select end_time from public.production_station_reports where id=r2)<>(time '14:00') or (select end_time from public.production_station_reports where id=r3)<>(time '13:00') then raise exception 'Different product timing overwritten';end if;
 ctx:=public.production_daily_print_context(r2);
 if jsonb_array_length(ctx->'reports')<>2 or ctx->'station'->>'name'<>'QA machine name' then raise exception 'Machine print context missing parts/name';end if;
 -- A bad sibling must not save any part of a batch.
 payload:=base||jsonb_build_object('production_date',current_date,'id',gen_random_uuid(),'item_id',fg,'machine_quantity',20);denied:=false;
 begin perform public.production_station_action('save',jsonb_build_object('capture_group_id',gen_random_uuid(),'products',jsonb_build_array(payload,base||jsonb_build_object('production_date',current_date,'id',gen_random_uuid(),'item_id',fg2,'machine_quantity',-1))));exception when others then denied:=true;end;
 if not denied or exists(select 1 from public.production_station_reports where id=(payload->>'id')::uuid) then raise exception 'Atomic batch saved a partial report';end if;
 perform set_config('request.jwt.claims','{}',true);denied:=false;
 begin perform public.production_station_action('save',payload);exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;denied:=true;end;if not denied then raise exception 'Anonymous report write';end if;
end $qa$;
select 'PASS mixed packing inventory/FG/WIP/idempotence, extra work validation/totals, machine batch across independent drafts, time preservation, PDF context, rollback and anonymous guards' as result;
