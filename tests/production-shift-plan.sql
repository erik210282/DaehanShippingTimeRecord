begin;
-- Before running, set test.production_user to an authorized supervisor/leader UUID.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.production_user'),'role','authenticated')::text,true);
do $test$
declare stations text[]; product uuid; payload jsonb; response jsonb; schedule public.production_shift_schedule; request_id uuid:=gen_random_uuid(); count_before int; failed boolean:=false; planid uuid;
begin
 select array_agg(code) into stations from (select code from public.inventory_workstations w where active and not exists(select 1 from public.production_live_runs r where r.station_code=w.code and r.deleted_at is null and r.closed_at is null) order by code limit 2) q;
 select t.item_id into product from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.deleted_at is null and i.active and i.category in ('FG','SEMI') limit 1;
 if array_length(stations,1)<2 or product is null then raise exception 'Missing fixture';end if;
 payload:=jsonb_build_object('id',request_id,'started_at',now()-interval '5 minutes','shift_hours',8,'stations',jsonb_build_array(
 jsonb_build_object('station_code',stations[1],'item_ids',jsonb_build_array(product),'planned_hours',8),
 jsonb_build_object('station_code',stations[2],'item_ids',jsonb_build_array(product),'started_at',now()+interval '200 days','planned_hours',12)));
 response:=public.production_shift_plan(payload);
 if response->'machines'->0->>'status'<>'started' or response->'machines'->1->>'status'<>'scheduled' then raise exception 'Mixed plan failed %',response;end if;
 if not exists(select 1 from public.production_live_runs where shift_start_id=md5(request_id::text||':'||stations[1])::uuid and planned_hours=8) then raise exception 'Immediate machine missing';end if;
 select * into schedule from public.production_shift_schedule where id=md5(request_id::text||':'||stations[2])::uuid;
 if (schedule.payload->>'planned_hours')::numeric<>12 then raise exception 'Custom hours missing';end if;
 if public.production_shift_plan(payload)<>response then raise exception 'Retry mismatch';end if;
 -- Invalid second machine must roll back the first schedule in the batch.
 select count(*) into count_before from public.production_shift_schedule;
 begin
  perform public.production_shift_plan(jsonb_build_object('id',gen_random_uuid(),'started_at',now()+interval '220 days','shift_hours',8,'stations',jsonb_build_array(
   jsonb_build_object('station_code',stations[1],'item_ids',jsonb_build_array(product)),
   jsonb_build_object('station_code',stations[2],'item_ids',jsonb_build_array(product),'planned_hours',25))));
 exception when others then
  if sqlerrm<>'pl_start_invalid' then raise;end if;failed:=true;
 end;
 if not failed or (select count(*) from public.production_shift_schedule)<>count_before then raise exception 'Partial save';end if;
 -- Editing a queued machine replaces its prior schedule, retaining the new duration.
 payload:=jsonb_build_object('id',gen_random_uuid(),'schedule_id',schedule.id,'schedule_version',schedule.updated_at,
 'started_at',now()+interval '201 days','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',stations[2],'item_ids',jsonb_build_array(product),'planned_hours',10)));
 perform public.production_shift_plan(payload);
 if (select status from public.production_shift_schedule where id=schedule.id)<>'cancelled' then raise exception 'Old schedule not replaced';end if;
 failed:=false;
 begin perform public.production_shift_plan(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())));
 exception when others then if sqlerrm<>'pr_invalid' then raise;end if;failed:=true;end;
 if not failed then raise exception 'Stale edit accepted';end if;
 perform set_config('request.jwt.claims','{}',true);
 failed:=false;
 begin perform public.production_shift_plan(jsonb_build_object('id',gen_random_uuid()));
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;failed:=true;end;
 if not failed then raise exception 'Anonymous plan accepted';end if;
end $test$;
select 'PASS: mixed start/schedule, custom duration, retries, atomic rollback, schedule replacement, stale edit and auth checks' as validation;
rollback;