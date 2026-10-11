
begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();raw uuid:=gen_random_uuid();bom_a uuid:=gen_random_uuid();bom_b uuid:=gen_random_uuid();grp uuid:=gen_random_uuid();session uuid:=gen_random_uuid();r1 uuid:=gen_random_uuid();r2 uuid:=gen_random_uuid();c1 uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();station text:='MULTI-TEST-'||substr(gen_random_uuid()::text,1,8);base jsonb;rows jsonb;result jsonb;finished timestamptz;n integer;start_at timestamptz:=clock_timestamp()-interval '2 hours';live_rows jsonb;
begin
 insert into public.inventory_workstations(code,name,machine_type) values(station,'Multi product test','test');
 insert into public.inventory_items(id,part_number,category) values(a,'MULTI-A-'||a,'SEMI'),(b,'MULTI-B-'||b,'SEMI'),(raw,'MULTI-RAW-'||raw,'RAW');
 insert into public.inventory_boms(id,finished_item_id,version,active) values(bom_a,a,1,true),(bom_b,b,1,true);
 insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(bom_a,raw,2),(bom_b,raw,3);
 perform public.production_live_action('target_batch',jsonb_build_object('products',jsonb_build_array(jsonb_build_object('item_id',a,'target_8h','800','target_10h','1000','warning_percent','90','critical_percent','75'),jsonb_build_object('item_id',b,'target_8h','400','target_10h','500','warning_percent','90','critical_percent','75'))));

 perform public.production_supply_action('load',jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw,'quantity',1000,'alert_minutes',60));
 perform public.production_supply_action('start',jsonb_build_object('id',grp,'started_at',start_at,'shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station,'item_ids',jsonb_build_array(a,b)))));
 perform public.production_supply_action('start',jsonb_build_object('id',grp,'started_at',start_at,'shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station,'item_ids',jsonb_build_array(a,b)))));
 if (select count(*) from public.production_live_runs where shift_start_id=grp)<>2 then raise exception 'shift retry duplicated runs';end if;
 select id into r1 from public.production_live_runs where shift_start_id=grp and item_id=a;
 select id into r2 from public.production_live_runs where shift_start_id=grp and item_id=b;
 if exists(select 1 from public.production_checkpoints where run_id in(r1,r2)) then raise exception 'starting shift fabricated reports';end if;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 begin
  perform public.production_supply_action('start',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at,'shift_hours',8,'stations','[]'::jsonb));
  raise exception 'operator started manager shift';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 perform public.production_live_action('checkpoint',jsonb_build_object('id',c1,'run_id',r1,'quantity',7));
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 perform public.production_live_action('checkpoint',jsonb_build_object('id',c2,'run_id',r1,'quantity',8));
 result:=public.production_live_snapshot_range(start_at-interval '1 minute',now()+interval '1 minute');
 if (select jsonb_array_length(x->'contributors') from jsonb_array_elements(result->'runs')x where x->>'id'=r1::text)<>2 then raise exception 'handoff reporter attribution lost';end if;
 finished:=clock_timestamp();
 perform public.production_live_action('finish_batch',jsonb_build_object('products',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'run_id',r1,'item_id',a,'quantity',8,'finished_at',finished),jsonb_build_object('id',gen_random_uuid(),'run_id',r2,'item_id',b,'quantity',11,'finished_at',finished))));

 base:=jsonb_build_object('station_code',station,'production_date',(start_at at time zone 'UTC')::date,'start_time',to_char(start_at at time zone 'UTC','HH24:MI'),'end_time',to_char(finished at time zone 'UTC','HH24:MI'),'ends_next_day',(start_at at time zone 'UTC')::date<>(finished at time zone 'UTC')::date,'people',2,'report_mode','production','downtime_events','[]'::jsonb,'machine_minutes',floor(extract(epoch from(finished-start_at))/60),'downtime_minutes',0,'break_minutes',0,'break_count',0,'rework_quantity',0,'full_boxes',0,'pallets',0,'rework_completed',true,'catalog_packing',false);
 rows:=jsonb_build_array(base||jsonb_build_object('id',gen_random_uuid(),'live_run_id',r1,'item_id',a,'machine_quantity',8,'scrap_quantity',1),base||jsonb_build_object('id',gen_random_uuid(),'live_run_id',r2,'item_id',b,'machine_quantity',11,'scrap_quantity',0));
 perform public.production_station_action('submit',jsonb_build_object('capture_group_id',gen_random_uuid(),'products',rows));
 for result in select value from jsonb_array_elements(rows) loop perform public.production_station_action('post',jsonb_build_object('id',result->>'id'));end loop;
 result:=public.production_supply_snapshot();
 if (select (m->>'confirmed_consumption')::numeric from jsonb_array_elements(result->'materials')m where m->>'station_code'=station)<>49 then raise exception 'scrap did not consume raw or counted twice';end if;
 if (select sum((w->>'quantity')::numeric) from jsonb_array_elements(result->'wip')w where w->>'station_code'=station)<>18 then raise exception 'unpacked output lost';end if;
 if exists(select 1 from jsonb_array_elements(result->'runs')r where r->>'id' in(r1::text,r2::text)) then raise exception 'posted run still estimated';end if;
 perform public.production_supply_action('start',jsonb_build_object('id',gen_random_uuid(),'started_at',clock_timestamp()-interval '1 second','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station,'item_ids',jsonb_build_array(a,b)))));
 result:=public.production_supply_snapshot();
 if (select (m->>'loaded_quantity')::numeric-(m->>'confirmed_consumption')::numeric from jsonb_array_elements(result->'materials')m where m->>'station_code'=station)<>951 then raise exception 'new shift reset material carryover';end if;
 if (select sum((w->>'quantity')::numeric) from jsonb_array_elements(result->'wip')w where w->>'station_code'=station)<>18 then raise exception 'new shift reset WIP';end if;
end $test$;
rollback;
