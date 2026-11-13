-- Supervisors may close active production with the last recorded total.
-- Reuse the normal close path to create the editable daily draft and audit the action.
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
 gap jsonb; previous_end timestamptz; previous_qty bigint; group_id uuid:=gen_random_uuid(); restore boolean;
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
  if jsonb_typeof(products) is distinct from 'array' or jsonb_array_length(products) not between 1 and 30
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
    if station is null then station:=r.station_code;session:=r.session_id;
    elsif station<>r.station_code or session is distinct from r.session_id then raise exception 'pr_invalid';end if;
    if exists(select 1 from public.production_station_reports where live_run_id=r.id and status<>'draft') then raise exception 'pl_reopen_posted';end if;
   end loop;
   for entry in select value from jsonb_array_elements(products) order by value->>'run_id' loop
    select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid;
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

CREATE OR REPLACE FUNCTION rls_internal.production_live_snapshot_range(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare snapshot jsonb; supervisor boolean:=(public.inventory_access('production') and exists (select 1 from public.global_department_memberships m where m.user_id=auth.uid() and m.department='production' and m.role='supervisor' and m.active));
begin
 snapshot:=rls_internal.production_live_snapshot_before_timed_reopen(p_from,p_to);
 return jsonb_set(snapshot,'{runs}',coalesce((select jsonb_agg(r||jsonb_build_object(
  'can_force_finish',supervisor and r->>'closed_at' is null and (r->>'started_at')::timestamptz < clock_timestamp() and not exists(select 1 from public.production_station_reports sr where sr.live_run_id=(r->>'id')::uuid and status<>'draft'),
  'can_reopen',coalesce((r->>'can_reopen')::boolean,false) and q.status is distinct from 'scheduled',
  'reopen_request_id',q.id,'reopen_scheduled_at',q.scheduled_at,'reopen_schedule_status',q.status,'reopen_error',q.error_code))
  from jsonb_array_elements(snapshot->'runs') r left join lateral(
   select * from rls_internal.production_reopen_requests where (r->>'id')::uuid=any(run_ids) and status in('scheduled','failed') order by created_at desc limit 1
  )q on true),'[]'));
end $function$;

CREATE OR REPLACE FUNCTION rls_internal.production_supply_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 return jsonb_build_object('schedules',coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at) from public.production_shift_schedule s where s.status in ('scheduled','failed') and s.started_at>=now()-interval '7 days'),'[]'::jsonb),
 'station_materials',coalesce((select jsonb_agg(jsonb_build_object('station_code',w.code,'item_id',m.item_id)) from public.inventory_workstations w cross join lateral rls_internal.production_station_raw_ids(w.code) m where w.active),'[]'::jsonb),
 'materials',coalesce((select jsonb_agg(to_jsonb(m)) from (
  select l.station_code,l.item_id,sum(case when l.deleted_at is null then l.quantity else 0 end) as loaded_quantity,coalesce(min(l.created_at) filter(where l.deleted_at is null),min(l.created_at)) as tracked_at,
  15::numeric as alert_minutes,
  coalesce((select sum(u.quantity) from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id),0) as confirmed_consumption,
  0::numeric as confirmed_baseline
  from public.production_material_loads l group by l.station_code,l.item_id having bool_or(l.deleted_at is null) or exists(select 1 from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id)
 ) m),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select lr.*,((public.inventory_access('production') and exists (select 1 from public.global_department_memberships m where m.user_id=auth.uid() and m.department='production' and m.role='supervisor' and m.active)) and lr.closed_at is null and lr.started_at<clock_timestamp() and not exists(select 1 from public.production_station_reports done where done.live_run_id=lr.id and done.status<>'draft')) as can_force_finish,coalesce(sr.machine_quantity,0) as posted_quantity,
   coalesce((select jsonb_agg(jsonb_build_object('item_id',bl.ingredient_id,'per_unit',bl.quantity_per_unit*(1+bl.waste_rate))) from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id join public.inventory_items i on i.id=bl.ingredient_id and i.category in ('RAW','SEMI') where ib.finished_item_id=lr.item_id and ib.active and not ib.archived),'[]'::jsonb) as raw_recipe
  from public.production_live_runs lr left join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production'
  where lr.deleted_at is null and (lr.closed_at is null or sr.id is null)
 ) r),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(to_jsonb(b)) from public.production_material_baselines b),'[]'::jsonb),
 'wip',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select sr.station_code,sr.item_id,sum(case when sr.report_mode='packing' then -sr.packed_quantity else sr.good_quantity-sr.packed_quantity end) quantity
  from public.production_station_reports sr where sr.status='posted' and not exists(select 1 from public.production_station_consumptions c where c.report_id=sr.id and c.source='repack') group by sr.station_code,sr.item_id
 ) w where w.quantity<>0),'[]'::jsonb),
 'loads',coalesce((select jsonb_agg(to_jsonb(l)) from (select ml.*,o.nombre as reporter_name from public.production_material_loads ml left join public.operadores o on o.uid=ml.created_by where ml.deleted_at is null order by ml.created_at desc) l),'[]'::jsonb)
 );
end $function$;
