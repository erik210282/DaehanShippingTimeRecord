do $qa$
declare qa_user uuid; operator_uid uuid; st text:='QA-TIMED-'||left(gen_random_uuid()::text,8); items uuid[];
 a timestamptz:=clock_timestamp()-interval '8 hours'; b timestamptz; c timestamptz;
 runs uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; ses uuid:=gen_random_uuid(); request uuid;
 payload jsonb; result jsonb; original jsonb; n integer; denied boolean; other_run uuid:=gen_random_uuid();
begin
 select x.user_id into qa_user from public.global_system_admins x join public.operadores o on o.uid=x.user_id where o.activo limit 1;
 select array_agg(item_id) into items from (select t.item_id from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.deleted_at is null and i.active and i.category in('FG','SEMI') limit 2)x;
 if qa_user is null or array_length(items,1)<>2 then raise exception 'Missing authorized fixtures';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_user,'role','authenticated')::text,true);
 insert into public.inventory_workstations(code,name,machine_type,active) select st,'QA timed reopen',machine_type,true from public.inventory_workstations where active limit 1;
 for n in 1..2 loop
  insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
   values(runs[n],ses,st,items[n],a,qa_user,100,2,90,75,8,750);
  perform public.production_live_action('finish',jsonb_build_object('id',gen_random_uuid(),'run_id',runs[n],'quantity',100*n,'finished_at',a+interval '4 hours','timezone','UTC'));
 end loop;
 b:=a+interval '4 hours';c:=clock_timestamp()-interval '1 hour';
 payload:=jsonb_build_object('id',gen_random_uuid(),'reopened_at',a+interval '5 hours','products',jsonb_build_array(jsonb_build_object('run_id',runs[1],'closed_at',b),jsonb_build_object('run_id',runs[2],'closed_at',b)));
 result:=public.production_live_action('reopen_batch',payload);
 if result->>'status'<>'started' or (select count(*) from public.production_live_runs where id=any(runs) and closed_at is null and latest_quantity in(100,200) and closed_intervals->0->>'end_at'=(to_jsonb(a+interval '5 hours')#>>'{}'))<>2 then raise exception 'Timed batch reopen failed %',result;end if;
 if public.production_live_action('reopen_batch',payload)<>result then raise exception 'Idempotence failed';end if;
 -- Unchanged totals are valid in a normal close after reopening.
 perform public.production_live_action('finish',jsonb_build_object('id',gen_random_uuid(),'run_id',runs[1],'quantity',100,'finished_at',c,'timezone','UTC'));
 if (select latest_quantity from public.production_live_runs where id=runs[1])<>100 then raise exception 'Equal normal finish changed total';end if;
 perform public.production_live_action('reopen_batch',jsonb_build_object('id',gen_random_uuid(),'reopened_at',clock_timestamp()-interval '30 min','products',jsonb_build_array(jsonb_build_object('run_id',runs[1],'closed_at',c))));
 payload:=jsonb_build_object('id',gen_random_uuid(),'reason','Accidental reopen; preserve the original close','timezone','UTC','products',jsonb_build_array(jsonb_build_object('run_id',runs[1]),jsonb_build_object('run_id',runs[2])));
 result:=public.production_live_action('force_finish_batch',payload);
 if (select closed_at from public.production_live_runs where id=runs[1]) is distinct from c or (select closed_at from public.production_live_runs where id=runs[2]) is distinct from b then raise exception 'Forced accidental reopen did not restore closes %',result;end if;
 if (select sum(latest_quantity) from public.production_live_runs where id=any(runs))<>300 or (select count(*) from public.production_station_reports where live_run_id=any(runs))<>2 then raise exception 'Force duplicated quantities/reports';end if;
 if public.production_live_action('force_finish_batch',payload)<>result then raise exception 'Force retry failed';end if;
 -- Future requests do not reopen before their clock time.
 request:=gen_random_uuid();payload:=jsonb_build_object('id',request,'reopened_at',clock_timestamp()+interval '20 min','products',jsonb_build_array(jsonb_build_object('run_id',runs[1],'closed_at',c),jsonb_build_object('run_id',runs[2],'closed_at',b)));
 result:=public.production_live_action('reopen_batch',payload);
 if result->>'status'<>'scheduled' or exists(select 1 from public.production_live_runs where id=any(runs) and closed_at is null) then raise exception 'Future opened early';end if;
 perform rls_internal.production_process_reopens();
 if (select status from rls_internal.production_reopen_requests where id=request)<>'scheduled' then raise exception 'Future processed early';end if;
 result:=public.production_live_snapshot_range(a-interval '1 minute',clock_timestamp()+interval '1 minute');
 if not exists(select 1 from jsonb_array_elements(result->'runs') x where x->>'id'=runs[1]::text and x->>'reopen_schedule_status'='scheduled' and x->>'can_reopen'='false') then raise exception 'Scheduled state missing';end if;
 update rls_internal.production_reopen_requests set scheduled_at=clock_timestamp()-interval '1 min' where id=request;
 perform rls_internal.production_process_reopens();
 if (select count(*) from public.production_live_runs where id=any(runs) and closed_at is null)<>2 or (select status from rls_internal.production_reopen_requests where id=request)<>'started' then raise exception 'Due batch did not start';end if;
 original:=(select jsonb_agg(closed_intervals) from public.production_live_runs where id=any(runs));perform rls_internal.production_process_reopens();
 if (select jsonb_agg(closed_intervals) from public.production_live_runs where id=any(runs)) is distinct from original then raise exception 'Worker duplicated a reopen';end if;
 -- The last known totals remain usable after a real resumed capture, too.
 perform public.production_live_action('checkpoint',jsonb_build_object('id',gen_random_uuid(),'run_id',runs[1],'quantity',110));
 perform public.production_live_action('force_finish_batch',jsonb_build_object('id',gen_random_uuid(),'reason','Supervisor closes using latest captured totals','timezone','UTC','products',jsonb_build_array(jsonb_build_object('run_id',runs[1]),jsonb_build_object('run_id',runs[2]))));
 if (select latest_quantity from public.production_live_runs where id=runs[1])<>110 or (select count(*) from public.production_station_reports where live_run_id=any(runs))<>2 then raise exception 'Captured total lost or report duplicated';end if;
 -- A bad sibling cancels the entire batch.
 denied:=false;begin
  perform public.production_live_action('reopen_batch',jsonb_build_object('id',gen_random_uuid(),'reopened_at',clock_timestamp(),'products',jsonb_build_array(jsonb_build_object('run_id',runs[1],'closed_at',(select closed_at from public.production_live_runs where id=runs[1])),jsonb_build_object('run_id',runs[2],'closed_at',b-interval '1 min'))));
 exception when others then if sqlerrm<>'pl_reopen_changed' then raise;end if;denied:=true;end;
 if not denied or exists(select 1 from public.production_live_runs where id=any(runs) and closed_at is null) then raise exception 'Partial reopen saved';end if;
 -- New conflicts fail visibly instead of opening another session on the machine.
 b:=(select closed_at from public.production_live_runs where id=runs[2]);request:=gen_random_uuid();
 perform public.production_live_action('reopen_batch',jsonb_build_object('id',request,'reopened_at',clock_timestamp()+interval '10 min','products',jsonb_build_array(jsonb_build_object('run_id',runs[2],'closed_at',b))));
 insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
 values(other_run,other_run,st,items[1],clock_timestamp()-interval '2 min',qa_user,100,2,90,75,8,750);
 update rls_internal.production_reopen_requests set scheduled_at=clock_timestamp()-interval '1 min' where id=request;
 perform rls_internal.production_process_reopens();
 if (select status from rls_internal.production_reopen_requests where id=request)<>'failed' or (select error_code from rls_internal.production_reopen_requests where id=request)<>'pl_station_busy' then raise exception 'Conflict did not fail visibly';end if;
 perform public.production_live_action('cancel_reopen',jsonb_build_object('id',gen_random_uuid(),'schedule_id',request));
 if (select status from rls_internal.production_reopen_requests where id=request)<>'cancelled' then raise exception 'Cancel failed';end if;
 -- Operators cannot force-close, and anonymous callers cannot reopen.
 select o.uid into operator_uid from public.operadores o where o.activo and o.uid<>qa_user and not exists(select 1 from public.global_system_admins a where a.user_id=o.uid) and not exists(select 1 from public.global_department_memberships m where m.user_id=o.uid and m.active and m.department='production' and m.role in('lider','supervisor')) limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_uid,'role','authenticated')::text,true);denied:=false;
 begin perform public.production_live_action('force_finish',jsonb_build_object('id',gen_random_uuid(),'run_id',other_run,'reason','This must be rejected'));exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Operator forced closure';end if;
 perform set_config('request.jwt.claims','{}',true);denied:=false;
 begin perform public.production_live_action('reopen_batch',payload);exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;denied:=true;end;
 if not denied then raise exception 'Anonymous reopen';end if;
end $qa$;
select 'PASS timed batch reopen, unchanged normal close, audited force recovery, latest totals, future clock/worker/conflict/cancel, idempotence, atomicity and role guards' as result;
