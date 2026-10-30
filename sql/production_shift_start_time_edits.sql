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
  if new_start is null or not isfinite(new_start) or new_start>clock_timestamp() then raise exception 'pl_start_invalid';end if;
  if new_start is distinct from r.started_at then
   if jsonb_array_length(r.closed_intervals)>0 or exists(select 1 from public.production_checkpoints where run_id=r.id and deleted_at is null and recorded_at<=new_start) or exists(select 1 from public.production_live_runs x where x.station_code=r.station_code and x.session_id is distinct from r.session_id and x.deleted_at is null and coalesce(x.closed_at,clock_timestamp())>new_start and x.started_at<clock_timestamp()) then raise exception 'mp_start_conflict';end if;
  end if;
  before_rows:=before_rows||jsonb_build_array(to_jsonb(r));update public.production_live_runs set started_at=new_start,planned_hours=hours,updated_at=clock_timestamp(),updated_by=actor where id=r.id;
  if new_start is distinct from r.started_at then perform rls_internal.production_live_recalculate(r.id);end if;
 end loop;
 if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st where s.status='scheduled' and st->>'station_code'=station and s.started_at<(select max(started_at+(coalesce(planned_hours,shift_hours)+0.5)*interval '1 hour') from public.production_live_runs where station_code=station and session_id=session and closed_at is null and deleted_at is null) and s.started_at+(coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)+0.5)*interval '1 hour'>(select min(started_at) from public.production_live_runs where station_code=station and session_id=session and closed_at is null and deleted_at is null)) then raise exception 'ps_schedule_overlap';end if;
 insert into rls_internal.production_plan_changes(id,actor,payload,before_data) values(request,actor,p_data,before_rows);update public.catalog_updates set version=version+1 where id=1;return jsonb_build_object('saved',true);
end $function$
;

