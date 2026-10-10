
begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();raw uuid:=gen_random_uuid();bom_a uuid:=gen_random_uuid();bom_b uuid:=gen_random_uuid();grp uuid:=gen_random_uuid();session uuid:=gen_random_uuid();r1 uuid:=gen_random_uuid();r2 uuid:=gen_random_uuid();c1 uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();station text:='MULTI-TEST-'||substr(gen_random_uuid()::text,1,8);base jsonb;rows jsonb;result jsonb;n integer;start_at timestamptz:=clock_timestamp()-interval '2 hours';live_rows jsonb;
begin
 insert into public.inventory_workstations(code,name,machine_type) values(station,'Multi product test','test');
 insert into public.inventory_items(id,part_number,category) values(a,'MULTI-A-'||a,'SEMI'),(b,'MULTI-B-'||b,'SEMI'),(raw,'MULTI-RAW-'||raw,'RAW');
 insert into public.inventory_boms(id,finished_item_id,version,active) values(bom_a,a,1,true),(bom_b,b,1,true);
 insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(bom_a,raw,2),(bom_b,raw,3);
 perform public.production_live_action('target_batch',jsonb_build_object('products',jsonb_build_array(jsonb_build_object('item_id',a,'target_8h','800','target_10h','1000','warning_percent','90','critical_percent','75'),jsonb_build_object('item_id',b,'target_8h','400','target_10h','500','warning_percent','90','critical_percent','75'))));
 base:=jsonb_build_object('station_code',station,'production_date',current_date-2,'start_time','08:00','end_time','16:00','ends_next_day',false,'people',2,'staff_names','Test A, Test B','turns',null,'report_mode','production','downtime_events',jsonb_build_array(jsonb_build_object('type','lunch','start_time','12:00','end_time','12:30','minutes',30,'note','')),'machine_minutes',450,'downtime_minutes',0,'downtime_reason','','break_minutes',30,'break_count',1,'scrap_quantity',0,'rework_quantity',0,'full_boxes',0,'pallets',0,'packaging_type',null,'note','','rework_completed',true,'catalog_packing',false);
 rows:=jsonb_build_array(base||jsonb_build_object('id',r1,'item_id',a,'machine_quantity',7),base||jsonb_build_object('id',r2,'item_id',b,'machine_quantity',11));
 perform public.production_station_action('save',jsonb_build_object('capture_group_id',grp,'products',rows));
 if (select count(*) from public.production_station_reports where capture_group_id=grp)<>2 then raise exception 'batch save lost products';end if;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 perform public.production_station_action('submit',jsonb_build_object('capture_group_id',grp,'products',rows));
 if exists(select 1 from public.production_station_reports where capture_group_id=grp and created_by<> '270a4a29-8fe0-4eee-8267-9e797be33216'::uuid) then raise exception 'handoff changed creator';end if;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 if (select count(*) from public.production_station_reports where capture_group_id=grp and status='submitted')<>2 then raise exception 'parallel submission failed';end if;
 begin
  perform public.production_station_action('submit',base||jsonb_build_object('id',gen_random_uuid(),'item_id',a,'machine_quantity',5));
  raise exception 'overlap was allowed';
 exception when others then if sqlerrm<>'pr_overlap' then raise;end if;end;
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,effective_date,created_by) values(raw,'RAW',1,'OPENING','multi-test:'||raw,current_date,auth.uid());
 perform public.production_station_action('post',jsonb_build_object('id',r1));
 perform public.production_station_action('post',jsonb_build_object('id',r2));
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw and kind='CONSUMPTION')<>-47 then raise exception 'wrong independent consumption';end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw and area='RAW')<>-46 then raise exception 'negative stock was not recorded';end if;
 perform public.production_station_action('post',jsonb_build_object('id',r1));
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw and area='RAW')<>-46 then raise exception 'retry duplicated negative consumption';end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id in(a,b) and area='WIP')<>18 then raise exception 'wrong product output';end if;
 live_rows:=jsonb_build_array(jsonb_build_object('id',c1,'run_id',gen_random_uuid(),'session_id',session,'item_id',a,'station_code',station,'started_at',start_at,'shift_hours','8','quantity','70'),jsonb_build_object('id',c2,'run_id',gen_random_uuid(),'session_id',session,'item_id',b,'station_code',station,'started_at',start_at,'shift_hours','8','quantity','90'));
 result:=public.production_live_action('checkpoint_batch',jsonb_build_object('products',live_rows));
 if (select count(*) from public.production_live_runs where session_id=session)<>2 then raise exception 'parallel active products failed';end if;
 if (select count(distinct recorded_at) from public.production_checkpoints where id in(c1,c2))<>1 then raise exception 'checkpoint times differ';end if;
 perform public.production_live_action('checkpoint_batch',jsonb_build_object('products',live_rows));
 if (select count(*) from public.production_checkpoints where id in(c1,c2))<>2 then raise exception 'retry duplicated checkpoint';end if;
 begin
  perform public.production_live_action('checkpoint',jsonb_build_object('id',gen_random_uuid(),'run_id',gen_random_uuid(),'item_id',a,'station_code',station,'started_at',start_at,'shift_hours','8','quantity','1'));
  raise exception 'second session was allowed';
 exception when others then if sqlerrm<>'pl_station_busy' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 perform public.production_live_action('checkpoint_batch',jsonb_build_object('products',jsonb_build_array((live_rows->0)||jsonb_build_object('id',gen_random_uuid(),'quantity','71'),(live_rows->1)||jsonb_build_object('id',gen_random_uuid(),'quantity','91'))));
 if (select count(*) from public.production_checkpoints where run_id in(select id from public.production_live_runs where session_id=session) and created_by=auth.uid())<>2 then raise exception 'handoff reporter attribution lost';end if;
 begin
  perform public.production_live_action('delete_run',jsonb_build_object('run_id',live_rows->0->>'run_id'));
  raise exception 'foreign destructive action allowed';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 begin
  perform public.production_live_action('checkpoint_batch',jsonb_build_object('products',jsonb_build_array((live_rows->0)||jsonb_build_object('id',gen_random_uuid(),'quantity','80'),(live_rows->1)||jsonb_build_object('id',gen_random_uuid(),'quantity','invalid'))));
  raise exception 'bad batch was allowed';
 exception when others then if sqlerrm<>'pl_quantity_invalid' then raise;end if;end;
 if (select count(*) from public.production_checkpoints where run_id in(select id from public.production_live_runs where session_id=session))<>4 then raise exception 'batch failure left partial writes';end if;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 perform public.production_live_action('close_batch',jsonb_build_object('products',live_rows));
 if exists(select 1 from public.production_live_runs where session_id=session and closed_at is null) then raise exception 'machine close left active products';end if;
end $test$;
select 'multi-product daily, inventory, progress, retry, overlap, permissions and atomic failure passed' as result;
rollback;