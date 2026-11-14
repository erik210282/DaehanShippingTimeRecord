-- Allow a supervisor to close selected runs across station sessions in one transaction.
CREATE OR REPLACE FUNCTION rls_internal.production_live_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); request uuid; products jsonb; entry jsonb; ids uuid[];
 moment timestamptz; actual timestamptz; r public.production_live_runs; manager boolean;
 audit rls_internal.production_lifecycle_actions; scheduled rls_internal.production_reopen_requests;
 answer jsonb; outcomes jsonb:='[]'; station text; session uuid; reason text;
 gap jsonb; previous_end timestamptz; previous_qty bigint; group_id uuid; group_key text; groups jsonb:='{}'; restore boolean;
begin
 if p_action not in('reopen','reopen_batch','force_finish','force_finish_batch','cancel_reopen') then
  return rls_internal.production_live_action_before_timed_reopen(p_action,p_data);
 end if;
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=rls_internal.production_lifecycle_manager();
 request:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 perform pg_advisory_xact_lock(hashtextextended('production-lifecycle:'||request::text,0));
 select * into audit from rls_internal.production_lifecycle_actions where id=request;
 if audit.id is not null then
  if audit.actor<>uid or audit.action<>p_action or audit.payload is distinct from p_data then raise exception 'pr_invalid';end if;
  return audit.result;
 end if;
 if p_action='cancel_reopen' then
  select * into scheduled from rls_internal.production_reopen_requests where id=(p_data->>'schedule_id')::uuid for update;
  if scheduled.id is null or (not manager and scheduled.actor<>uid) then raise exception 'pr_forbidden';end if;
  if scheduled.status not in('scheduled','failed','cancelled') then raise exception 'pl_reopen_changed';end if;
  update rls_internal.production_reopen_requests set status='cancelled',updated_at=clock_timestamp() where id=scheduled.id;
  update public.catalog_updates set version=version+1 where id=1;
  answer:=jsonb_build_object('saved',true,'status','cancelled');
 else
  products:=case when p_action in('reopen_batch','force_finish_batch') then p_data->'products'
   else jsonb_build_array(jsonb_build_object('run_id',p_data->'run_id','closed_at',p_data->'closed_at')) end;
  if jsonb_typeof(products) is distinct from 'array' then raise exception 'pr_invalid';end if;
  if jsonb_array_length(products)=0 or (p_action='reopen_batch' and jsonb_array_length(products)>30)
   or (select count(distinct value->>'run_id') from jsonb_array_elements(products))<>jsonb_array_length(products) then raise exception 'pr_invalid';end if;
  select array_agg((value->>'run_id')::uuid order by value->>'run_id') into ids from jsonb_array_elements(products);
  if p_action in('reopen','reopen_batch') then
   moment:=coalesce(nullif(p_data->>'reopened_at','')::timestamptz,date_trunc('minute',clock_timestamp()));
   for entry in select value from jsonb_array_elements(products) order by value->>'run_id' loop
    select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
    if r.id is null or r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
    -- Installed clients without a request ID can safely retry their original single-product reopen.
    if r.closed_at is null and p_action='reopen' and not(p_data?'id') and exists(select 1 from jsonb_array_elements(r.closed_intervals) where (value->>'start_at')::timestamptz=nullif(entry->>'closed_at','')::timestamptz) then return jsonb_build_object('saved',true);end if;
    if r.closed_at is null or r.closed_at is distinct from nullif(entry->>'closed_at','')::timestamptz then raise exception 'pl_reopen_changed';end if;
    if station is null then station:=r.station_code;session:=r.session_id;
    elsif station<>r.station_code or session is distinct from r.session_id then raise exception 'pr_invalid';end if;
    if moment<date_trunc('minute',r.closed_at) then raise exception 'pl_reopen_time_invalid';end if;
    moment:=greatest(moment,r.closed_at);
    if moment>=r.started_at+interval '24 hours' or clock_timestamp()>=r.started_at+interval '24 hours' then raise exception 'pl_reopen_expired';end if;
    if exists(select 1 from public.production_station_reports where live_run_id=r.id and status<>'draft') then raise exception 'pl_reopen_posted';end if;
   end loop;
   if exists(select 1 from rls_internal.production_reopen_requests where status='scheduled' and run_ids&&ids) then raise exception 'pl_reopen_already_scheduled';end if;
   if moment>clock_timestamp() then
    insert into rls_internal.production_reopen_requests(id,actor,scheduled_at,run_ids,products,status) values(request,uid,moment,ids,products,'scheduled');
    update public.catalog_updates set version=version+1 where id=1;
    answer:=jsonb_build_object('saved',true,'status','scheduled','request_id',request,'reopened_at',moment);
   else
    actual:=rls_internal.production_apply_reopen(products,moment,uid);
    answer:=jsonb_build_object('saved',true,'status','started','reopened_at',actual);
   end if;
  else
   if not (public.inventory_access('production') and exists (select 1 from public.global_department_memberships m where m.user_id=auth.uid() and m.department='production' and m.role='supervisor' and m.active)) then raise exception 'pr_forbidden';end if;
   reason:=btrim(coalesce(p_data->>'reason',''));if length(reason)>2000 then raise exception 'pl_force_reason_required';end if;
   -- Lock/authorize all rows before changing any of them.
   for entry in select value from jsonb_array_elements(products) order by value->>'run_id' loop
    select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
    if r.id is null or r.deleted_at is not null then raise exception 'pr_forbidden';end if;
    if r.closed_at is not null then raise exception 'pl_run_closed';end if;
    if r.started_at>=clock_timestamp() then raise exception 'pl_finish_invalid';end if;
    if exists(select 1 from public.production_station_reports where live_run_id=r.id and status<>'draft') then raise exception 'pl_reopen_posted';end if;
   end loop;
   for entry in select value from jsonb_array_elements(products) order by value->>'run_id' loop
    select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid;
    -- Each station session keeps its own group of editable daily reports.
    group_key:=jsonb_build_array(r.station_code,r.session_id)::text;
    if not (groups ? group_key) then
     groups:=groups||jsonb_build_object(group_key,gen_random_uuid());
    end if;
    group_id:=(groups->>group_key)::uuid;
    gap:=r.closed_intervals->(jsonb_array_length(r.closed_intervals)-1);previous_end:=(gap->>'start_at')::timestamptz;
    select quantity into previous_qty from public.production_checkpoints where run_id=r.id and deleted_at is null and recorded_at=previous_end order by id desc limit 1;
    restore:=previous_qty is not null and r.latest_quantity=previous_qty and not exists(select 1 from public.production_checkpoints where run_id=r.id and deleted_at is null and recorded_at>previous_end and quantity>previous_qty);
    if restore then
     moment:=previous_end;
     update public.production_live_runs set closed_intervals=closed_intervals-(jsonb_array_length(closed_intervals)-1) where id=r.id;
    else moment:=least(clock_timestamp(),r.started_at+interval '24 hours');end if;
    perform rls_internal.production_live_action_before_timed_reopen('finish',jsonb_build_object('id',gen_random_uuid(),'capture_group_id',group_id,'run_id',r.id,'quantity',r.latest_quantity,'finished_at',moment,'timezone',coalesce(nullif(p_data->>'timezone',''),r.timezone,'UTC')));
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('run_id',r.id,'quantity',r.latest_quantity,'finished_at',moment,'restored_previous_close',restore));
   end loop;
   answer:=jsonb_build_object('saved',true,'products',outcomes);
  end if;
 end if;
 insert into rls_internal.production_lifecycle_actions(id,actor,action,payload,result) values(request,uid,p_action,p_data,answer);
 return answer;
end $function$;

