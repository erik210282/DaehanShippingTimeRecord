begin;
do $qa$
declare u uuid; station text:='QA-FIXED-'||left(gen_random_uuid()::text,8); prod uuid; run uuid:=gen_random_uuid();cp uuid:=gen_random_uuid();a timestamptz;b timestamptz;r public.production_station_reports;events jsonb;reply jsonb;
begin
 select a.user_id into u from public.global_system_admins a join public.operadores o on o.uid=a.user_id and o.activo limit 1;
 if u is null then raise exception 'QA requires an active system admin fixture';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 a:=(((now() at time zone 'America/Los_Angeles')::date-1)+time '06:00') at time zone 'America/Los_Angeles';b:=a+interval '8.5 hours';
 select item_id into prod from public.production_targets where deleted_at is null limit 1;
 insert into public.inventory_workstations(code,name,machine_type,active) select station,'QA automatic breaks',machine_type,true from public.inventory_workstations where active limit 1;
 insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
 values(run,run,station,prod,a,u,100,2,90,75,8,750);
 perform public.production_live_action('finish',jsonb_build_object('id',cp,'run_id',run,'quantity',700,'finished_at',b,'timezone','America/Los_Angeles','downtime_events',jsonb_build_array(jsonb_build_object('type','maintenance','start_at',a+interval '1 hour 50 min','end_at',a+interval '2 hours 30 min'))));
 select * into r from public.production_station_reports where live_run_id=run;
 if r.id is null or r.break_minutes<>60 or r.downtime_minutes<>25 or r.machine_minutes<>425 or r.elapsed_minutes<>510 then raise exception 'QA totals wrong %',to_jsonb(r);end if;
 if (select jsonb_array_length(downtime_events) from public.production_live_runs where id=run)<>5 then raise exception 'QA fixed/manual merge wrong';end if;
 if abs((select expected_quantity from public.production_checkpoints where id=cp)-100*425.0/60)>0.001 then raise exception 'QA target recalculation wrong';end if;
 reply:=public.shipping_records_page(1,25,'{}');
 if jsonb_array_length(reply->'records')<>25 then raise exception 'QA page size wrong';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements((public.shipping_records_page(1,25,'{}')->'records')||(public.shipping_records_page(2,25,'{}')->'records')))<>50 then raise exception 'QA pages overlap';end if;
 events:=rls_internal.production_report_fixed_breaks(jsonb_build_object('production_date','2026-10-20','start_time','17:00','end_time','03:45','ends_next_day',true,'timezone','America/Los_Angeles','downtime_events','[]'::jsonb))->'downtime_events';
 if jsonb_array_length(events)<>5 or (select sum((value->>'minutes')::numeric) from jsonb_array_elements(events))<>90 then raise exception 'QA night report wrong';end if;
end $qa$;
set local role authenticated;
select jsonb_build_object('page_rows',jsonb_array_length(public.shipping_records_page(1,25,'{}')->'records'),'total',public.shipping_records_page(1,25,'{}')->'total','result','PASS authenticated paginated Records; forced partial/daily fixed breaks, overlap splitting, exact UPH and overnight schedule') as qa;
reset role;
rollback;