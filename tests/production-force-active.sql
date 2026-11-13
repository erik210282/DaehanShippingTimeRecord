-- Run in a rollback transaction against a populated app database.
do $test$
declare
 supervisor_uid uuid;
 leader_uid uuid;
 station text := 'QA-FORCE-'||left(gen_random_uuid()::text,8);
 items uuid[];
 runs uuid[] := array[gen_random_uuid(),gen_random_uuid()];
 session_id uuid := gen_random_uuid();
 started timestamptz := clock_timestamp()-interval '1 hour';
 request jsonb;
 result jsonb;
 draft public.production_station_reports;
 n integer;
begin
 select m.user_id into supervisor_uid from public.global_department_memberships m join public.operadores o on o.uid=m.user_id and o.activo where m.department='production' and m.role='supervisor' and m.active limit 1;
 select m.user_id into leader_uid from public.global_department_memberships m join public.operadores o on o.uid=m.user_id and o.activo where m.department='production' and m.role='lider' and m.active limit 1;
 select array_agg(id) into items from (select id from public.inventory_items where active and category in ('FG','SEMI') limit 2) i;
 if supervisor_uid is null or leader_uid is null or cardinality(items)<>2 then raise exception 'Missing fixtures'; end if;
 insert into public.inventory_workstations(code,name,machine_type,active) select station,'QA force finish',machine_type,true from public.inventory_workstations where active limit 1;
 for n in 1..2 loop
  insert into public.production_live_runs(id,session_id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
  values(runs[n],session_id,station,items[n],started,supervisor_uid,100,2,90,75,8,750);
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor_uid,'role','authenticated')::text,true);
 perform public.production_live_action('checkpoint',jsonb_build_object('id',gen_random_uuid(),'run_id',runs[1],'quantity',42,'recorded_at',started+interval '30 minutes'));
 request:=jsonb_build_object('id',gen_random_uuid(),'timezone','America/Los_Angeles','products',jsonb_build_array(jsonb_build_object('run_id',runs[1]),jsonb_build_object('run_id',runs[2])));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',leader_uid,'role','authenticated')::text,true);
 begin
  perform public.production_live_action('force_finish_batch',request);
  raise exception 'Leader unexpectedly closed a session';
 exception when raise_exception then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',supervisor_uid,'role','authenticated')::text,true);
 if not exists(select 1 from jsonb_array_elements(public.production_supply_snapshot()->'runs') r where r->>'id'=runs[1]::text and (r->>'can_force_finish')::boolean) then raise exception 'Supervisor cannot see open session';end if;
 result:=public.production_live_action('force_finish_batch',request);
 if public.production_live_action('force_finish_batch',request)<>result then raise exception 'Request retry changed the result';end if;
 if (select count(*) from public.production_live_runs where id=any(runs) and closed_at is not null)<>2 then raise exception 'Session did not close';end if;
 if not exists(select 1 from public.production_station_reports where live_run_id=runs[1] and status='draft' and progress_draft and machine_quantity=42 and people is null) then raise exception 'Latest count not saved to draft';end if;
 if not exists(select 1 from public.production_station_reports where live_run_id=runs[2] and status='draft' and progress_draft and machine_quantity=0 and people is null) then raise exception 'Empty count draft not saved';end if;
 if not exists(select 1 from rls_internal.production_lifecycle_actions where id=(request->>'id')::uuid and actor=supervisor_uid) then raise exception 'Missing audit entry';end if;
 select * into draft from public.production_station_reports where live_run_id=runs[1] and status='draft';
 perform public.production_station_action('save',to_jsonb(draft)||jsonb_build_object('timezone','America/Los_Angeles','start_time',to_char(draft.start_time,'HH24:MI'),'end_time',to_char(draft.end_time,'HH24:MI'),'people',2,'machine_quantity',45,'scrap_quantity',0,'rework_quantity',0,'full_boxes',0,'pallets',0));
 if not exists(select 1 from public.production_station_reports where id=draft.id and machine_quantity=45 and people=2 and status='draft') then raise exception 'Forced daily draft could not be edited';end if;
end $test$;
