begin;
do $qa$
declare u uuid;station text:='QA-REOPEN-'||left(gen_random_uuid()::text,8);prod uuid;run uuid:=gen_random_uuid();session uuid:=gen_random_uuid();cp uuid:=gen_random_uuid();a timestamptz;b timestamptz;resumed timestamptz;lr public.production_live_runs;daily public.production_station_reports;daily_id uuid;reply jsonb;before_expected numeric;bad boolean;
begin
 select x.user_id into u from public.global_system_admins x join public.operadores o on o.uid=x.user_id and o.activo limit 1;
 if u is null then raise exception 'QA requires active admin';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 a:=date_trunc('minute',now())-interval '6 hours';b:=a+interval '2 hours';
 select item_id into prod from public.production_targets where deleted_at is null limit 1;
 insert into public.inventory_workstations(code,name,machine_type,active) select station,'QA reopen',machine_type,true from public.inventory_workstations where active limit 1;
 insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
 values(run,session,station,prod,a,u,100,2,90,75,8,750);
 perform public.production_live_action('finish',jsonb_build_object('id',cp,'run_id',run,'quantity',100,'finished_at',b,'timezone','America/Los_Angeles','downtime_events','[]'::jsonb));
 select id into daily_id from public.production_station_reports where live_run_id=run;
 select expected_quantity into before_expected from public.production_checkpoints where id=cp;
 reply:=public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',b));
 select * into lr from public.production_live_runs where id=run;
 resumed:=(reply->>'reopened_at')::timestamptz;
 if lr.closed_at is not null or lr.latest_quantity<>100 or jsonb_array_length(lr.closed_intervals)<>1 or (lr.closed_intervals->0->>'start_at')::timestamptz<>b or (lr.closed_intervals->0->>'end_at')::timestamptz<>resumed then raise exception 'QA reopen lost state %',to_jsonb(lr);end if;
 if abs((select expected_quantity from public.production_checkpoints where id=cp)-before_expected)>0.001 then raise exception 'QA historic target changed';end if;
 perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',b));
 if (select jsonb_array_length(closed_intervals) from public.production_live_runs where id=run)<>1 then raise exception 'QA retry duplicated gap';end if;
 -- Backdate only this isolated fixture's resume to test a subsequent capture and closure.
 update public.production_live_runs set closed_intervals=jsonb_build_array(jsonb_build_object('start_at',b,'end_at',b+interval '1 hour','reopened_by',u)) where id=run;
 cp:=gen_random_uuid();
 perform public.production_live_action('finish',jsonb_build_object('id',cp,'run_id',run,'quantity',250,'finished_at',a+interval '5 hours','timezone','America/Los_Angeles','downtime_events','[]'::jsonb));
 select * into lr from public.production_live_runs where id=run;
 select * into daily from public.production_station_reports where live_run_id=run;
 if daily.id<>daily_id or daily.machine_quantity<>250 or daily.elapsed_minutes<>240 or daily.downtime_minutes<>0 or lr.latest_quantity<>250 then raise exception 'QA final totals/draft wrong %',to_jsonb(daily);end if;
 if abs((select expected_quantity from public.production_checkpoints where id=cp)-100*daily.machine_minutes/60)>0.001 then raise exception 'QA final target counts closed time';end if;
 if exists(select 1 from jsonb_array_elements(lr.downtime_events) e,jsonb_array_elements(lr.downtime_events) f where e->>'type'='inactive' and f->>'type'<>'inactive' and tstzrange((e->>'start_at')::timestamptz,(e->>'end_at')::timestamptz,'[)') && tstzrange((f->>'start_at')::timestamptz,(f->>'end_at')::timestamptz,'[)')) then raise exception 'QA breaks overlap closed interval';end if;
 bad:=false;
 begin perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',b));exception when others then if sqlerrm='pl_reopen_changed' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'QA stale reopen accepted';end if;
 -- A different active session must not be merged by reopening.
 insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
 values(gen_random_uuid(),gen_random_uuid(),station,prod,a+interval '5 hours 30 minutes',u,100,2,90,75,8,750);
 bad:=false;
 begin perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',lr.closed_at));exception when others then if sqlerrm='pl_station_busy' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'QA conflicting session accepted';end if;
 update public.production_live_runs set deleted_at=now() where station_code=station and id<>run;
 update public.production_station_reports set status='posted',progress_draft=false,people=1,scrap_quantity=0,rework_quantity=0,full_boxes=0 where id=daily_id;
 bad:=false;
 begin perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',lr.closed_at));exception when others then if sqlerrm='pl_reopen_posted' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'QA posted report accepted';end if;
 update public.production_station_reports set status='draft',progress_draft=true where id=daily_id;
 perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',lr.closed_at));
 if (select jsonb_array_length(closed_intervals) from public.production_live_runs where id=run)<>2 then raise exception 'QA second cycle missing';end if;
 bad:=false;
 begin perform public.production_live_action('finish',jsonb_build_object('id',gen_random_uuid(),'run_id',run,'quantity',260,'finished_at',a+interval '5 hours 30 minutes','timezone','America/Los_Angeles'));exception when others then if sqlerrm='pl_finish_invalid' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'QA finish inside closed interval accepted';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 bad:=false;
 begin perform public.production_live_action('reopen',jsonb_build_object('run_id',run,'closed_at',lr.closed_at));exception when others then if sqlerrm in ('ra_denied','pr_forbidden') then bad:=true;else raise;end if;end;
 if not bad then raise exception 'QA unauthorized reopen accepted';end if;
end $qa$;
select 'PASS reopen preserves quantities/checkpoints; retries are safe; inactive time excluded; final daily updated; stale, conflicting and unauthorized requests denied' result;
rollback;
