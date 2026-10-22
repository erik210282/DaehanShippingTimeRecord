-- Timed machine/product reopen and audited recovery of an accidental reopen.
create table rls_internal.production_reopen_requests(
 id uuid primary key, actor uuid not null, scheduled_at timestamptz not null,
 run_ids uuid[] not null, products jsonb not null,
 status text not null check(status in('scheduled','started','failed','cancelled')),
 error_code text, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), started_at timestamptz
);
alter table rls_internal.production_reopen_requests enable row level security;
revoke all on rls_internal.production_reopen_requests from public,anon,authenticated;
create index production_reopen_due on rls_internal.production_reopen_requests(scheduled_at) where status='scheduled';
create index production_reopen_runs on rls_internal.production_reopen_requests using gin(run_ids);
create table rls_internal.production_lifecycle_actions(
 id uuid primary key, actor uuid not null, action text not null, payload jsonb not null,
 result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table rls_internal.production_lifecycle_actions enable row level security;
revoke all on rls_internal.production_lifecycle_actions from public,anon,authenticated;

create function rls_internal.production_lifecycle_manager() returns boolean
language sql stable security definer set search_path='' as $$
 select public.inventory_access('production') and (public.inventory_access('production',true)
 or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and active and department='production' and role='lider'));
$$;
revoke all on function rls_internal.production_lifecycle_manager() from public,anon,authenticated;

-- The public API continues to authenticate through the original wrapper chain.
alter function rls_internal.production_live_action(text,jsonb) rename to production_live_action_before_timed_reopen;
revoke all on function rls_internal.production_live_action_before_timed_reopen(text,jsonb) from public,anon,authenticated;

create function rls_internal.production_apply_reopen(p_products jsonb,p_at timestamptz,p_actor uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare entry jsonb; r public.production_live_runs; station text; session uuid;
 moment timestamptz:=p_at; manager boolean:=rls_internal.production_lifecycle_manager();
begin
 if auth.uid() is distinct from p_actor or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 -- Validate the complete batch before changing a product.
 for entry in select value from jsonb_array_elements(p_products) order by value->>'run_id' loop
  select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
  if r.id is null or r.deleted_at is not null or (not manager and r.created_by<>p_actor) then raise exception 'pr_forbidden';end if;
  if station is null then station:=r.station_code;session:=r.session_id;
  elsif station<>r.station_code or session is distinct from r.session_id then raise exception 'pr_invalid';end if;
  if r.closed_at is null then raise exception 'pl_reopen_changed';end if;
  if r.closed_at is distinct from nullif(entry->>'closed_at','')::timestamptz then raise exception 'pl_reopen_changed';end if;
  if moment is null or moment<date_trunc('minute',r.closed_at) then raise exception 'pl_reopen_time_invalid';end if;
  moment:=greatest(moment,r.closed_at);
  if moment>=r.started_at+interval '24 hours' or clock_timestamp()>=r.started_at+interval '24 hours' or jsonb_array_length(r.closed_intervals)>=100 then raise exception 'pl_reopen_expired';end if;
  if exists(select 1 from public.production_station_reports where live_run_id=r.id and status<>'draft') then raise exception 'pl_reopen_posted';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(station,1));
 if exists(select 1 from public.production_live_runs x where x.station_code=station and x.deleted_at is null
  and x.session_id is distinct from session and x.started_at<=greatest(moment,clock_timestamp())
  and coalesce(x.closed_at,'infinity'::timestamptz)>moment) then raise exception 'pl_station_busy';end if;
 for entry in select value from jsonb_array_elements(p_products) order by value->>'run_id' loop
  select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid;
  update public.production_live_runs set closed_at=null,closed_intervals=closed_intervals||jsonb_build_array(
   jsonb_build_object('start_at',r.closed_at,'end_at',moment,'reopened_by',p_actor)),updated_at=clock_timestamp(),updated_by=p_actor where id=r.id;
  update public.production_station_reports set progress_draft=true,updated_at=clock_timestamp() where live_run_id=r.id and status='draft';
  perform rls_internal.production_live_recalculate(r.id);
 end loop;
 update public.catalog_updates set version=version+1 where id=1;
 return moment;
end $$;
revoke all on function rls_internal.production_apply_reopen(jsonb,timestamptz,uuid) from public,anon,authenticated;

create function rls_internal.production_live_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
   if not manager then raise exception 'pr_forbidden';end if;
   reason:=btrim(coalesce(p_data->>'reason',''));if length(reason)<5 or length(reason)>2000 then raise exception 'pl_force_reason_required';end if;
   -- Lock/authorize all rows before changing any of them.
   for entry in select value from jsonb_array_elements(products) order by value->>'run_id' loop
    select * into r from public.production_live_runs where id=(entry->>'run_id')::uuid for update;
    if r.id is null or r.deleted_at is not null then raise exception 'pr_forbidden';end if;
    if r.closed_at is not null or jsonb_array_length(r.closed_intervals)=0 then raise exception 'pl_force_reopen_only';end if;
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
    else moment:=clock_timestamp();end if;
    perform rls_internal.production_live_action_before_timed_reopen('finish',jsonb_build_object('id',gen_random_uuid(),'capture_group_id',group_id,'run_id',r.id,'quantity',r.latest_quantity,'finished_at',moment,'timezone',coalesce(nullif(p_data->>'timezone',''),r.timezone,'UTC')));
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('run_id',r.id,'quantity',r.latest_quantity,'finished_at',moment,'restored_previous_close',restore));
   end loop;
   answer:=jsonb_build_object('saved',true,'products',outcomes);
  end if;
 end if;
 insert into rls_internal.production_lifecycle_actions(id,actor,action,payload,result) values(request,uid,p_action,p_data,answer);
 return answer;
end $$;
revoke all on function rls_internal.production_live_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_live_action(text,jsonb) to authenticated;
create or replace function public.production_live_action(p_action text,p_data jsonb) returns jsonb language sql set search_path='' as $$ select rls_internal.production_live_action($1,$2); $$;
revoke all on function public.production_live_action(text,jsonb) from public,anon;
grant execute on function public.production_live_action(text,jsonb) to authenticated;

create function rls_internal.production_process_reopens() returns integer language plpgsql security definer set search_path='' as $$
declare task rls_internal.production_reopen_requests; claims text:=current_setting('request.jwt.claims',true);total integer:=0;
begin
 for task in select * from rls_internal.production_reopen_requests where status='scheduled' and scheduled_at<=clock_timestamp() order by scheduled_at,id for update skip locked loop
  begin
   perform set_config('request.jwt.claims',jsonb_build_object('sub',task.actor,'role','authenticated')::text,true);
   perform rls_internal.production_apply_reopen(task.products,task.scheduled_at,task.actor);
   update rls_internal.production_reopen_requests set status='started',started_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null where id=task.id;
   update rls_internal.production_lifecycle_actions set result=result||jsonb_build_object('status','started') where id=task.id;
   total:=total+1;
  exception when others then
   update rls_internal.production_reopen_requests set status='failed',error_code=case when sqlerrm in('pr_forbidden','pl_reopen_changed','pl_reopen_expired','pl_reopen_posted','pl_station_busy','pl_reopen_time_invalid') then sqlerrm else 'pr_save_error' end,updated_at=clock_timestamp() where id=task.id;
   update public.catalog_updates set version=version+1 where id=1;
  end;
  perform set_config('request.jwt.claims',coalesce(claims,''),true);
 end loop;
 return total;
end $$;
revoke all on function rls_internal.production_process_reopens() from public,anon,authenticated;
select cron.schedule('production-scheduled-reopens','* * * * *','select rls_internal.production_process_reopens();');

alter function rls_internal.production_live_snapshot_range(timestamptz,timestamptz) rename to production_live_snapshot_before_timed_reopen;
revoke all on function rls_internal.production_live_snapshot_before_timed_reopen(timestamptz,timestamptz) from public,anon,authenticated;
create function rls_internal.production_live_snapshot_range(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; manager boolean:=rls_internal.production_lifecycle_manager();
begin
 snapshot:=rls_internal.production_live_snapshot_before_timed_reopen(p_from,p_to);
 return jsonb_set(snapshot,'{runs}',coalesce((select jsonb_agg(r||jsonb_build_object(
  'can_force_finish',manager and r->>'closed_at' is null and jsonb_array_length(coalesce(r->'closed_intervals','[]'))>0 and not exists(select 1 from public.production_station_reports sr where sr.live_run_id=(r->>'id')::uuid and status<>'draft'),
  'can_reopen',coalesce((r->>'can_reopen')::boolean,false) and q.status is distinct from 'scheduled',
  'reopen_request_id',q.id,'reopen_scheduled_at',q.scheduled_at,'reopen_schedule_status',q.status,'reopen_error',q.error_code))
  from jsonb_array_elements(snapshot->'runs') r left join lateral(
   select * from rls_internal.production_reopen_requests where (r->>'id')::uuid=any(run_ids) and status in('scheduled','failed') order by created_at desc limit 1
  )q on true),'[]'));
end $$;
revoke all on function rls_internal.production_live_snapshot_range(timestamptz,timestamptz) from public,anon;
grant execute on function rls_internal.production_live_snapshot_range(timestamptz,timestamptz) to authenticated;
create or replace function public.production_live_snapshot_range(p_from timestamptz,p_to timestamptz) returns jsonb language sql set search_path='' as $$select rls_internal.production_live_snapshot_range($1,$2);$$;
revoke all on function public.production_live_snapshot_range(timestamptz,timestamptz) from public,anon;
grant execute on function public.production_live_snapshot_range(timestamptz,timestamptz) to authenticated;
