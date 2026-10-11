
alter table public.production_station_reports add column progress_draft boolean not null default false;
alter table public.production_station_reports alter column people drop not null,alter column scrap_quantity drop not null,alter column rework_quantity drop not null,alter column full_boxes drop not null;
alter table public.production_station_reports add constraint production_report_missing_fields check ((progress_draft and status='draft') or (people is not null and scrap_quantity is not null and rework_quantity is not null and full_boxes is not null));
alter function rls_internal.production_live_action(text,jsonb) rename to production_live_action_progress_base;
create or replace function rls_internal.production_live_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; entry jsonb; lr public.production_live_runs; zone text; start_local timestamp; finish_local timestamp; elapsed numeric; unplanned numeric; planned numeric; breaks integer; events jsonb;
begin
 result:=rls_internal.production_live_action_progress_base(p_action,p_data);
 if p_action in ('finish','finish_batch') then
  for entry in select value from jsonb_array_elements(case when p_action='finish_batch' then p_data->'products' else jsonb_build_array(p_data) end) loop
   select * into lr from public.production_live_runs where id=(entry->>'run_id')::uuid;
   if lr.id is null or lr.closed_at is null then raise exception 'pr_invalid';end if;
   zone:=coalesce(nullif(entry->>'timezone',''),'UTC');
   if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
   start_local:=lr.started_at at time zone zone;finish_local:=lr.closed_at at time zone zone;
   elapsed:=extract(epoch from lr.closed_at-lr.started_at)/60;
   select coalesce(jsonb_agg(jsonb_build_object('type',e->>'type','note',coalesce(e->>'note',''),'start_time',to_char((e->>'start_at')::timestamptz at time zone zone,'HH24:MI'),'end_time',to_char((e->>'end_at')::timestamptz at time zone zone,'HH24:MI'),'minutes',extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60)),'[]'::jsonb),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' not in ('break','lunch')),0),
    coalesce(sum(extract(epoch from (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz)/60) filter(where e->>'type' in ('break','lunch')),0),
    count(*) filter(where e->>'type' in ('break','lunch'))
   into events,unplanned,planned,breaks from jsonb_array_elements(lr.downtime_events) e;
   insert into public.production_station_reports(id,live_run_id,capture_group_id,station_code,item_id,bom_id,production_date,start_time,end_time,ends_next_day,elapsed_minutes,machine_minutes,downtime_minutes,break_minutes,break_count,people,machine_quantity,scrap_quantity,rework_quantity,full_boxes,report_mode,downtime_events,status,created_by,progress_draft)
   values(gen_random_uuid(),lr.id,lr.session_id,lr.station_code,lr.item_id,(select id from public.inventory_boms where finished_item_id=lr.item_id and active and not archived limit 1),start_local::date,start_local::time,finish_local::time,start_local::date<>finish_local::date,elapsed,greatest(0,elapsed-unplanned-planned),unplanned,planned,breaks,null,lr.latest_quantity,null,null,null,'production',events,'draft',auth.uid(),true)
   on conflict (live_run_id) where live_run_id is not null and report_mode='production' do nothing;
  end loop;
 end if;
 return result;
end $$;
revoke all on function rls_internal.production_live_action_progress_base(text,jsonb) from public,anon,authenticated;
revoke all on function rls_internal.production_live_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_live_action(text,jsonb) to authenticated;
create or replace function rls_internal.production_station_action_core(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare run uuid; result uuid; existing_draft uuid; lr public.production_live_runs;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in('save','submit') then
  run:=nullif(p_data->>'live_run_id','')::uuid;
  if run is null then select live_run_id into run from public.production_station_reports where id=(p_data->>'id')::uuid;end if;
  if run is not null then
   select * into lr from public.production_live_runs where id=run;
   if lr.id is null or lr.station_code is distinct from p_data->>'station_code' or lr.item_id is distinct from (p_data->>'item_id')::uuid or lr.deleted_at is not null then raise exception 'pr_invalid';end if;
   select id into existing_draft from public.production_station_reports where live_run_id=run and report_mode='production' and status='draft';
   if existing_draft is not null then p_data:=jsonb_set(p_data,'{id}',to_jsonb(existing_draft));end if;
   if p_action='submit' and p_data->>'report_mode'='production' and lr.closed_at is null then raise exception 'ps_finish_first';end if;
  end if;
 end if;
 result:=rls_internal.production_station_action_supply_base(p_action,p_data);
 if p_action in('save','submit') then update public.production_station_reports set live_run_id=run,progress_draft=false where id=result;end if;
 return result;
end $$;


create or replace function rls_internal.production_delete_shift(p_session uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare leader boolean;
begin
 leader:=public.inventory_access('production',true) or exists(select 1 from public.global_department_memberships where user_id=auth.uid() and department='production' and active and role='lider');
 if auth.uid() is null or not leader then raise exception 'pr_forbidden';end if;
 perform 1 from public.production_live_runs where coalesce(session_id,id)=p_session and deleted_at is null order by id for update;
 if not found then raise exception 'pr_invalid';end if;
 if exists(select 1 from public.production_station_reports d join public.production_live_runs r on r.id=d.live_run_id where coalesce(r.session_id,r.id)=p_session and not d.progress_draft) then raise exception 'ps_shift_report_exists';end if;
 delete from public.production_station_reports d using public.production_live_runs r where d.live_run_id=r.id and coalesce(r.session_id,r.id)=p_session and d.progress_draft and d.status='draft';
 update public.production_live_runs set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid() where coalesce(session_id,id)=p_session and deleted_at is null;
 return true;
end $$;
create or replace function public.production_delete_shift(p_session uuid)
returns boolean language sql set search_path='' as $$ select rls_internal.production_delete_shift(p_session) $$;
revoke all on function rls_internal.production_delete_shift(uuid),public.production_delete_shift(uuid) from public,anon;
grant execute on function rls_internal.production_delete_shift(uuid),public.production_delete_shift(uuid) to authenticated;


alter function rls_internal.production_station_action(text,jsonb) rename to production_station_action_capture_base;
create or replace function rls_internal.production_station_action(p_action text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry jsonb; entries jsonb:='[]'; draft public.production_station_reports; capture uuid; all_existing boolean:=true;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_action in ('save','submit') then
  if p_data ? 'products' then
   if jsonb_typeof(p_data->'products') is distinct from 'array' then raise exception 'pr_invalid';end if;
   for entry in select value from jsonb_array_elements(p_data->'products') loop
    select * into draft from public.production_station_reports where live_run_id=nullif(entry->>'live_run_id','')::uuid and report_mode='production' and status='draft';
    if draft.id is not null then
     entry:=entry||jsonb_build_object('id',draft.id);
     if capture is null then capture:=draft.capture_group_id;
     elsif capture is distinct from draft.capture_group_id then raise exception 'pr_invalid';end if;
    else all_existing:=false;
    end if;
    entries:=entries||jsonb_build_array(entry);
   end loop;
   p_data:=p_data||jsonb_build_object('products',entries);
   if all_existing and capture is not null then p_data:=p_data||jsonb_build_object('capture_group_id',capture);end if;
  else
   select * into draft from public.production_station_reports where live_run_id=nullif(p_data->>'live_run_id','')::uuid and report_mode='production' and status='draft';
   if draft.id is not null then p_data:=p_data||jsonb_build_object('id',draft.id);end if;
  end if;
 end if;
 return rls_internal.production_station_action_capture_base(p_action,p_data);
end $$;
revoke all on function rls_internal.production_station_action_capture_base(text,jsonb) from public,anon,authenticated;
revoke all on function rls_internal.production_station_action(text,jsonb) from public,anon;
grant execute on function rls_internal.production_station_action(text,jsonb) to authenticated;
