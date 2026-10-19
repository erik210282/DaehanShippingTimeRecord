begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare station text:='FLOOR-'||substr(gen_random_uuid()::text,1,8); raw1 uuid:=gen_random_uuid();raw2 uuid:=gen_random_uuid();other uuid:=gen_random_uuid();product uuid:=gen_random_uuid();bom uuid:=gen_random_uuid();run uuid:=gen_random_uuid();cp uuid:=gen_random_uuid();final_id uuid:=gen_random_uuid();batch jsonb;result jsonb;started timestamptz:=clock_timestamp()-interval '3 hours';finished timestamptz:=clock_timestamp()-interval '1 hour';captured timestamptz;legacy text[];
begin
 insert into public.inventory_items(id,part_number,category) values(raw1,'FLOOR-RAW1-'||raw1,'RAW'),(raw2,'FLOOR-RAW2-'||raw2,'RAW'),(other,'FLOOR-OTHER-'||other,'RAW'),(product,'FLOOR-FG-'||product,'FG');
 insert into public.inventory_workstations(code,name,machine_type,materials) values(station,'Floor test','test',jsonb_build_array(jsonb_build_object('item_id',product)));
 insert into public.inventory_boms(id,finished_item_id,version,active) values(bom,product,1,true);
 insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(bom,raw1,2),(bom,raw2,3);
 if (select count(*) from rls_internal.production_station_raw_ids(station))<>2 then raise exception 'station recipe RAW filtering failed';end if;
 if exists(select 1 from rls_internal.production_station_raw_ids(station) where item_id=other) then raise exception 'unrelated material leaked';end if;
 batch:=jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw1,'quantity','12.5','alert_minutes',300),jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw2,'quantity','34')));
 perform public.production_supply_action('load-batch',batch);
 perform public.production_supply_action('load-batch',batch);
 if (select count(*) from public.production_material_loads where station_code=station)<>2 then raise exception 'load retry duplicated materials';end if;
 if (select quantity from public.production_material_loads where station_code=station and item_id=raw1)<>12.5 or (select quantity from public.production_material_loads where station_code=station and item_id=raw2)<>34 then raise exception 'independent material quantities lost';end if;
 if exists(select 1 from public.production_material_loads where station_code=station and alert_minutes<>15) then raise exception 'alert threshold not fixed';end if;
 begin
  perform public.production_supply_action('load-batch',jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw1,'quantity','5'),jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',other,'quantity','5'))));
  raise exception 'unrelated RAW load accepted';
 exception when others then if sqlerrm<>'ps_station_material_invalid' then raise;end if;end;
 if (select count(*) from public.production_material_loads where station_code=station)<>2 then raise exception 'invalid batch partially saved';end if;
 perform public.production_live_action('target',jsonb_build_object('item_id',product,'target_8h','750','target_10h','930','warning_percent','90','critical_percent','75'));
 perform public.production_live_action('checkpoint',jsonb_build_object('id',cp,'run_id',run,'item_id',product,'station_code',station,'started_at',started,'shift_hours',8,'quantity','10'));
 select recorded_at into captured from public.production_checkpoints where id=cp;
 begin
  perform public.production_live_action('finish',jsonb_build_object('id',gen_random_uuid(),'run_id',run,'quantity','20','finished_at',started));
  raise exception 'finish before/equal start accepted';
 exception when others then if sqlerrm<>'pl_finish_invalid' then raise;end if;end;
 perform public.production_live_action('finish',jsonb_build_object('id',final_id,'run_id',run,'quantity','20','finished_at',finished));
 if not exists(select 1 from public.production_live_runs where id=run and closed_at=finished and latest_at=finished and latest_quantity=20) then raise exception 'actual finish or final total not authoritative';end if;
 if (select recorded_at from public.production_checkpoints where id=cp)<>captured then raise exception 'late report audit time changed';end if;
 if not exists(select 1 from public.production_station_reports where live_run_id=run and machine_quantity=20 and elapsed_minutes=extract(epoch from finished-started)/60) then raise exception 'daily draft uses capture time instead of actual duration';end if;
 result:=public.production_live_snapshot_range(started-interval '1 minute',clock_timestamp()+interval '1 minute');
 if not exists(select 1 from jsonb_array_elements(result->'runs') r where r->>'id'=run::text and (r->>'period_quantity')::numeric=20 and (r->>'period_at')::timestamptz=finished) then raise exception 'snapshot uses late partial instead of final total';end if;
 select array_agg(i.part_number order by i.part_number) into legacy from rls_internal.production_station_raw_ids('N-FOA01') r join public.inventory_items i on i.id=r.item_id;
 if not legacy @> array['W200GE01054A','W200GE02036A','W200GE22013A']::text[] or 'W200GE29009A'=any(legacy) or 'WT05TC27001B'=any(legacy) then raise exception 'legacy operation RAW hierarchy incorrect: %',legacy;end if;
end $test$;
select 'PASS independent quantities, fixed 15 min alerts, station filtering, atomic batches, actual finish before late capture, draft and snapshot totals, legacy ERP mapping' as result;
rollback;
