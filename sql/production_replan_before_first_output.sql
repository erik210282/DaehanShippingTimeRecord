CREATE OR REPLACE FUNCTION rls_internal.production_update_run_plan(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();request uuid:=(p_data->>'id')::uuid;entry jsonb;r public.production_live_runs;hours numeric;before_rows jsonb:='[]';old rls_internal.production_plan_changes;station text;session uuid;new_start timestamptz;
begin
 if actor is null or not rls_internal.role_activity_access('production','shifts') or not public.inventory_access('production') or not(public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=actor and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
 if request is null or jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 or (select count(distinct value->>'run_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('run-plan:'||request,0));select * into old from rls_internal.production_plan_changes where id=request;if old.id is not null then if old.actor<>actor or old.payload<>p_data then raise exception 'pr_invalid';end if;return jsonb_build_object('saved',true);end if;
 for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'run_id' loop
  select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
  if r.id is null or r.deleted_at is not null or r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if nullif(entry->>'version','')::timestamptz is distinct from coalesce(r.updated_at,r.created_at) then raise exception 'mp_changed';end if;
  if station is null then station:=r.station_code;session:=r.session_id;elsif station<>r.station_code or session is distinct from r.session_id then raise exception 'pr_invalid';end if;
  hours:=nullif(entry->>'planned_hours','')::numeric;if hours is null or hours<0.5 or hours>24 or hours::text in('NaN','Infinity','-Infinity') then raise exception 'pl_start_invalid';end if;
  new_start:=case when entry ? 'started_at' then nullif(entry->>'started_at','')::timestamptz else r.started_at end;
  if new_start is null or not isfinite(new_start) or new_start>clock_timestamp()+interval '366 days' then raise exception 'pl_start_invalid';end if;
  if new_start is distinct from r.started_at then
   if jsonb_array_length(r.closed_intervals)>0 or exists(select 1 from public.production_checkpoints where run_id=r.id and deleted_at is null and quantity>0 and recorded_at<=new_start) or exists(select 1 from public.production_live_runs x where x.station_code=r.station_code and x.session_id is distinct from r.session_id and x.deleted_at is null and coalesce(x.closed_at,clock_timestamp())>new_start and x.started_at<clock_timestamp()) then raise exception 'mp_start_conflict';end if;
  end if;
  before_rows:=before_rows||jsonb_build_array(to_jsonb(r));update public.production_live_runs set started_at=new_start,planned_hours=hours,updated_at=clock_timestamp(),updated_by=actor where id=r.id;
  if new_start is distinct from r.started_at then perform rls_internal.production_live_recalculate(r.id);end if;
 end loop;
 if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st where s.status='scheduled' and st->>'station_code'=station and s.started_at<(select max(started_at+(coalesce(planned_hours,shift_hours)+0.5)*interval '1 hour') from public.production_live_runs where station_code=station and session_id=session and closed_at is null and deleted_at is null) and s.started_at+(coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)+0.5)*interval '1 hour'>(select min(started_at) from public.production_live_runs where station_code=station and session_id=session and closed_at is null and deleted_at is null)) then raise exception 'ps_schedule_overlap';end if;
 insert into rls_internal.production_plan_changes(id,actor,payload,before_data) values(request,actor,p_data,before_rows);update public.catalog_updates set version=version+1 where id=1;return jsonb_build_object('saved',true);
end $function$
;

CREATE OR REPLACE FUNCTION rls_internal.production_live_recalculate(p_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.production_live_runs;c public.production_checkpoints;
begin
 select * into r from public.production_live_runs where id=p_run for update;
 update public.production_live_runs set downtime_events=rls_internal.production_merge_fixed_events(r.started_at,coalesce(r.closed_at,clock_timestamp()),r.downtime_events,r.timezone) where id=p_run;
 select * into r from public.production_live_runs where id=p_run;
 if exists(select 1 from (select quantity,lag(quantity) over(order by recorded_at,id) previous from public.production_checkpoints where run_id=p_run and deleted_at is null and (r.closed_at is null or recorded_at<=r.closed_at))x where quantity<previous) then raise exception 'pl_quantity_invalid';end if;
 if exists(select 1 from public.production_checkpoints where run_id=p_run and deleted_at is null and quantity>0 and recorded_at<=r.started_at) then raise exception 'pl_start_invalid';end if;
 if r.closed_at is not null and exists(select 1 from public.production_checkpoints late where late.run_id=p_run and late.deleted_at is null and late.quantity>(select final.quantity from public.production_checkpoints final where final.run_id=p_run and final.deleted_at is null and final.recorded_at=r.closed_at limit 1)) then raise exception 'pl_quantity_invalid';end if;
 update public.production_checkpoints cp set expected_quantity=case when r.shift_target is null or cp.recorded_at<=r.started_at then null else greatest(0.000001,r.shift_target/(case when r.shift_hours=10 then 9.3 else 7.5 end)*greatest(0,extract(epoch from(least(cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-r.started_at))/3600-
 coalesce((select sum(greatest(0,extract(epoch from(least((d->>'end_at')::timestamptz,cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-greatest((d->>'start_at')::timestamptz,r.started_at))))) from jsonb_array_elements(r.downtime_events)d),0)/3600)) end
 where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set attainment=quantity*100/nullif(expected_quantity,0) where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set performance=case when r.shift_target is null or recorded_at<=r.started_at then 'pending' when attainment<r.critical_percent then 'critical' when attainment<r.warning_percent then 'warning' else 'on_track' end where run_id=p_run and deleted_at is null;
 select * into c from public.production_checkpoints where run_id=p_run and deleted_at is null and recorded_at>r.started_at and (r.closed_at is null or recorded_at<=r.closed_at) order by recorded_at desc,id desc limit 1;
 update public.production_live_runs set latest_quantity=coalesce(c.quantity,0),latest_at=c.recorded_at where id=p_run;
end $function$
;
