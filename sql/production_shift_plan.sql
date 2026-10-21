-- Save a mixed immediate/future machine plan atomically and safely retry requests.
create table if not exists rls_internal.production_shift_plan_requests (
 id uuid primary key, created_by uuid not null references auth.users(id),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
revoke all on rls_internal.production_shift_plan_requests from public,anon,authenticated;
create or replace function rls_internal.production_shift_plan(p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); request uuid:=(p_data->>'id')::uuid;
 old_request rls_internal.production_shift_plan_requests;
 prior public.production_shift_schedule;
 entry jsonb; canonical jsonb; start_at timestamptz; planned numeric;
 child uuid; results jsonb:='[]'::jsonb; response jsonb;
begin
 if uid is null or not public.inventory_access('production') or not rls_internal.role_activity_access('production','shifts') or not (
 public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider')) then raise exception 'pr_forbidden';end if;
 if request is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-schedule',0));
 select * into old_request from rls_internal.production_shift_plan_requests where id=request;
 if old_request.id is not null then
  if old_request.created_by<>uid or old_request.payload<>p_data then raise exception 'pr_invalid';end if;
  return old_request.result;
 end if;
 if jsonb_typeof(p_data->'stations') is distinct from 'array' then raise exception 'pr_invalid';end if;
 if jsonb_array_length(p_data->'stations') not between 1 and 30 or
 (select count(distinct value->>'station_code') from jsonb_array_elements(p_data->'stations'))<>jsonb_array_length(p_data->'stations') then raise exception 'pr_invalid';end if;
 if nullif(p_data->>'schedule_id','') is not null then
  select * into prior from public.production_shift_schedule where id=(p_data->>'schedule_id')::uuid for update;
  if prior.id is null or prior.status not in ('scheduled','failed') or prior.updated_at is distinct from (p_data->>'schedule_version')::timestamptz then raise exception 'pr_invalid';end if;
  perform rls_internal.production_schedule_action('cancel',jsonb_build_object('id',prior.id));
 end if;
 for entry in select value from jsonb_array_elements(p_data->'stations') order by value->>'station_code' loop
  child:=md5(request::text||':'||(entry->>'station_code'))::uuid;
  start_at:=coalesce(nullif(entry->>'started_at',''),p_data->>'started_at')::timestamptz;
  planned:=coalesce(nullif(entry->>'planned_hours',''),nullif(p_data->>'planned_hours',''),p_data->>'shift_hours')::numeric;
  canonical:=jsonb_build_object('id',child,'started_at',start_at,'shift_hours',p_data->'shift_hours','planned_hours',planned,
   'stations',jsonb_build_array(jsonb_build_object('station_code',entry->>'station_code','item_ids',entry->'item_ids')));
  if start_at>clock_timestamp() then
   perform rls_internal.production_schedule_action('save',canonical);
   results:=results||jsonb_build_array(jsonb_build_object('id',child,'status','scheduled'));
  else
   if exists(select 1 from public.production_shift_schedule s cross join lateral jsonb_array_elements(s.payload->'stations') st
    where s.status='scheduled' and st->>'station_code'=entry->>'station_code'
    and s.started_at<start_at+planned*interval '1 hour'
    and s.started_at+coalesce(nullif(s.payload->>'planned_hours','')::numeric,(s.payload->>'shift_hours')::numeric)*interval '1 hour'>start_at) then raise exception 'ps_schedule_overlap';end if;
   perform rls_internal.production_supply_action('start',canonical);
   results:=results||jsonb_build_array(jsonb_build_object('id',child,'status','started'));
  end if;
 end loop;
 response:=jsonb_build_object('saved',true,'machines',results);
 insert into rls_internal.production_shift_plan_requests(id,created_by,payload,result) values(request,uid,p_data,response);
 return response;
end $$;
revoke all on function rls_internal.production_shift_plan(jsonb) from public,anon;
grant execute on function rls_internal.production_shift_plan(jsonb) to authenticated;
create or replace function public.production_shift_plan(p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select rls_internal.production_shift_plan(p_data); $$;
revoke all on function public.production_shift_plan(jsonb) from public,anon;
grant execute on function public.production_shift_plan(jsonb) to authenticated;
notify pgrst,'reload schema';
