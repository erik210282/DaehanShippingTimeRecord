
create or replace function rls_internal.production_fixed_events(p_start timestamptz,p_end timestamptz,p_zone text default 'America/Los_Angeles')
returns jsonb language plpgsql stable set search_path='' as $$
declare anchor date; h integer; night boolean; minute integer; a timestamptz;b timestamptz; result jsonb:='[]';i integer;
begin
 if p_start is null or p_end is null or p_end<=p_start then return result;end if;
 if not exists(select 1 from pg_timezone_names where name=p_zone) then raise exception 'pr_time_invalid';end if;
 h:=extract(hour from p_start at time zone p_zone);night:=h>=15 or h<5;anchor:=(p_start at time zone p_zone)::date;
 if night and h<5 then anchor:=anchor-1;end if;
 for i in 0..15 loop
  minute:=case when night then case i when 0 then 1140 when 1 then 1260 when 2 then 1380 else 1530+(i-3)*120 end
    else case i when 0 then 480 when 1 then 600 when 2 then 720 else 870+(i-3)*120 end end;
  a:=(anchor::timestamp+minute*interval '1 minute') at time zone p_zone;b:=a+case when i=2 then interval '30 minutes' else interval '15 minutes' end;
  exit when a>=p_end;
  if b>p_start then result:=result||jsonb_build_array(jsonb_build_object('type',case when i=2 then 'lunch' else 'break' end,'planned',true,'automatic',true,'schedule_key',anchor::text||':'||minute,'note','','start_at',greatest(a,p_start),'end_at',least(b,p_end)));end if;
 end loop;
 return result;
end $$;
create or replace function rls_internal.production_merge_fixed_events(p_start timestamptz,p_end timestamptz,p_events jsonb,p_zone text default 'America/Los_Angeles')
returns jsonb language plpgsql stable set search_path='' as $$
declare fixed jsonb:=rls_internal.production_fixed_events(p_start,p_end,p_zone);result jsonb:=fixed;e jsonb;f jsonb;a timestamptz;b timestamptz;span tstzrange;piece tstzrange;pieces tstzmultirange;
begin
 if jsonb_typeof(coalesce(p_events,'[]'))<>'array' then raise exception 'pr_downtime_invalid';end if;
 for e in select value from jsonb_array_elements(coalesce(p_events,'[]')) loop
  if coalesce((e->>'automatic')::boolean,false) then continue;end if;
  if not(e?'start_at' and e?'end_at') then
   if coalesce(e->>'type','') not in('break','lunch') then result:=result||jsonb_build_array(e);end if;continue;
  end if;
  a:=(e->>'start_at')::timestamptz;b:=(e->>'end_at')::timestamptz;
  if a is null or b is null or b<=a then raise exception 'pr_downtime_schedule_invalid';end if;
  if a<p_start or b>p_end then raise exception 'pr_downtime_schedule_invalid';end if;
  pieces:=tstzmultirange(tstzrange(a,b,'[)'));
  for f in select value from jsonb_array_elements(fixed) loop
   pieces:=pieces-tstzmultirange(tstzrange((f->>'start_at')::timestamptz,(f->>'end_at')::timestamptz,'[)'));
  end loop;
  for piece in select unnest(pieces) loop result:=result||jsonb_build_array(e||jsonb_build_object('start_at',lower(piece),'end_at',upper(piece)));end loop;
 end loop;
 return coalesce((select jsonb_agg(value order by (value->>'start_at')::timestamptz nulls last) from jsonb_array_elements(result)),'[]');
end $$;
alter table public.production_live_runs add column if not exists timezone text not null default 'America/Los_Angeles';
create or replace function rls_internal.production_automatic_run_breaks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.started_at is not null then
  new.downtime_events:=rls_internal.production_merge_fixed_events(new.started_at,coalesce(new.closed_at,clock_timestamp()),new.downtime_events,new.timezone);
 end if;return new;
end $$;
create trigger production_automatic_run_breaks before insert or update of started_at,closed_at,downtime_events,timezone
 on public.production_live_runs for each row execute function rls_internal.production_automatic_run_breaks();
create or replace function rls_internal.production_report_fixed_breaks(p_report jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare zone text:=coalesce(nullif(p_report->>'timezone',''),'America/Los_Angeles');a timestamp;b timestamp;x timestamp;y timestamp;e jsonb;events jsonb:='[]';merged jsonb;
begin
 if coalesce(p_report->>'start_time','')='' or coalesce(p_report->>'end_time','')='' or coalesce(p_report->>'production_date','')='' then return p_report;end if;
 a:=(p_report->>'production_date')::date+(p_report->>'start_time')::time;
 b:=(p_report->>'production_date')::date+(p_report->>'end_time')::time+case when coalesce((p_report->>'ends_next_day')::boolean,false) then interval '1 day' else interval '0' end;
 if b<=a or b-a>interval '24 hours' then raise exception 'pr_time_invalid';end if;
 for e in select value from jsonb_array_elements(coalesce(p_report->'downtime_events','[]')) loop
  if e?'start_time' and e?'end_time' then
   x:=a::date+(e->>'start_time')::time;y:=a::date+(e->>'end_time')::time;
   if x<a then x:=x+interval '1 day';end if;if y<=x then y:=y+interval '1 day';end if;
   e:=e||jsonb_build_object('start_at',x at time zone zone,'end_at',y at time zone zone);
  end if;events:=events||jsonb_build_array(e);
 end loop;
 merged:=rls_internal.production_merge_fixed_events(a at time zone zone,b at time zone zone,events,zone);
 select coalesce(jsonb_agg(entry.value||case when entry.value?'start_at' and entry.value?'end_at' then jsonb_build_object('start_time',to_char((entry.value->>'start_at')::timestamptz at time zone zone,'HH24:MI'),'end_time',to_char((entry.value->>'end_at')::timestamptz at time zone zone,'HH24:MI'),'minutes',extract(epoch from (entry.value->>'end_at')::timestamptz-(entry.value->>'start_at')::timestamptz)/60) else '{}'::jsonb end),'[]') into events from jsonb_array_elements(merged) as entry(value);
 return p_report||jsonb_build_object('downtime_events',events);
end $$;
revoke all on function rls_internal.production_fixed_events(timestamptz,timestamptz,text),rls_internal.production_merge_fixed_events(timestamptz,timestamptz,jsonb,text),rls_internal.production_automatic_run_breaks(),rls_internal.production_report_fixed_breaks(jsonb) from public,anon,authenticated;

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
 if exists(select 1 from public.production_checkpoints where run_id=p_run and deleted_at is null and recorded_at<=r.started_at) then raise exception 'pl_start_invalid';end if;
 if r.closed_at is not null and exists(select 1 from public.production_checkpoints late where late.run_id=p_run and late.deleted_at is null and late.quantity>(select final.quantity from public.production_checkpoints final where final.run_id=p_run and final.deleted_at is null and final.recorded_at=r.closed_at limit 1)) then raise exception 'pl_quantity_invalid';end if;
 update public.production_checkpoints cp set expected_quantity=greatest(0.000001,r.shift_target/(case when r.shift_hours=10 then 9.3 else 7.5 end)*greatest(0,extract(epoch from(least(cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-r.started_at))/3600-
 coalesce((select sum(greatest(0,extract(epoch from(least((d->>'end_at')::timestamptz,cp.recorded_at,coalesce(r.closed_at,cp.recorded_at))-greatest((d->>'start_at')::timestamptz,r.started_at))))) from jsonb_array_elements(r.downtime_events)d),0)/3600))
 where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set attainment=quantity*100/expected_quantity where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set performance=case when attainment<r.critical_percent then 'critical' when attainment<r.warning_percent then 'warning' else 'on_track' end where run_id=p_run and deleted_at is null;
 select * into c from public.production_checkpoints where run_id=p_run and deleted_at is null and (r.closed_at is null or recorded_at<=r.closed_at) order by recorded_at desc,id desc limit 1;
 update public.production_live_runs set latest_quantity=coalesce(c.quantity,0),latest_at=c.recorded_at where id=p_run;
end $function$
;
CREATE OR REPLACE FUNCTION rls_internal.production_station_action_capture_base(p_action text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payload jsonb:=p_data;events jsonb:='[]'::jsonb;d jsonb;v_id uuid;shift_start integer;shift_finish integer;event_start integer;event_finish integer;duration integer;night boolean;seen int4range[]:=array[]::int4range[];span int4range;entry jsonb;common jsonb;batch_group uuid;batch_result uuid;batch_ids uuid[]:=array[]::uuid[];existing_group uuid;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;

 if p_data ? 'products' then
  if p_action not in ('save','submit') or jsonb_typeof(p_data->'products') is distinct from 'array' or jsonb_array_length(p_data->'products') not between 1 and 30 then raise exception 'pr_invalid';end if;
  batch_group:=(p_data->>'capture_group_id')::uuid;
  if batch_group is null then raise exception 'pr_invalid';end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-group:'||batch_group,0));
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') or (select count(distinct value->>'id') from jsonb_array_elements(p_data->'products'))<>jsonb_array_length(p_data->'products') then raise exception 'pr_invalid';end if;
  common:=(select jsonb_object_agg(key,value) from jsonb_each((p_data->'products')->0) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode']));
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   if (select jsonb_object_agg(key,value) from jsonb_each(entry) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode'])) is distinct from common then raise exception 'pr_time_invalid';end if;
   if exists(select 1 from public.production_station_reports where id=(entry->>'id')::uuid and capture_group_id is not null and capture_group_id<>batch_group) then raise exception 'pr_invalid';end if;
   batch_ids:=array_append(batch_ids,(entry->>'id')::uuid);
  end loop;
  if exists(select 1 from public.production_station_reports r where capture_group_id=batch_group and not(id=any(batch_ids)) and
    (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)||jsonb_build_object('start_time',to_char(r.start_time,'HH24:MI'),'end_time',to_char(r.end_time,'HH24:MI'))) where key=any(array['station_code','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode'])) is distinct from common) then raise exception 'pr_locked';end if;
  if exists(select 1 from public.production_station_reports where capture_group_id=batch_group and not(id=any(batch_ids)) and item_id in(select (value->>'item_id')::uuid from jsonb_array_elements(p_data->'products'))) then raise exception 'pr_invalid';end if;
  for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
   batch_result:=rls_internal.production_station_action('save',entry-'products'-'capture_group_id');
   update public.production_station_reports set capture_group_id=batch_group where id=batch_result;
  end loop;
  if p_action='submit' then
   for entry in select value from jsonb_array_elements(p_data->'products') order by value->>'id' loop
    batch_result:=rls_internal.production_station_action('submit',entry-'products');
   end loop;
  end if;
  return batch_group;
 end if;
 if p_action in('save','submit') then
  p_data:=rls_internal.production_report_fixed_breaks(p_data);payload:=p_data;
  select capture_group_id into existing_group from public.production_station_reports where id=(p_data->>'id')::uuid;
  payload:=(payload-'capture_group_id')||jsonb_build_object('capture_group_id',existing_group);
 end if;

 if p_action in ('save','submit') then
  if p_data ? 'staff_names' and (jsonb_typeof(p_data->'staff_names') not in ('string','null') or length(coalesce(p_data->>'staff_names',''))>2000) then raise exception 'pr_invalid';end if;
  if p_data ? 'downtime_events' then
   if jsonb_typeof(p_data->'downtime_events') is distinct from 'array' or jsonb_array_length(p_data->'downtime_events')>1000 then raise exception 'pr_downtime_invalid';end if;
   if coalesce(p_data->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' or coalesce(p_data->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then raise exception 'pr_time_invalid';end if;
   shift_start:=extract(epoch from (p_data->>'start_time')::time)/60;
   night:=coalesce((p_data->>'ends_next_day')::boolean,false);
   shift_finish:=extract(epoch from (p_data->>'end_time')::time)/60+case when night then 1440 else 0 end;
   if shift_finish<=shift_start or shift_finish-shift_start>1440 then raise exception 'pr_time_invalid';end if;
   for d in select value from jsonb_array_elements(p_data->'downtime_events') loop
    if d ? 'start_time' or d ? 'end_time' then
     if coalesce(d->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(d->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'pr_downtime_schedule_invalid';end if;
     event_start:=extract(epoch from (d->>'start_time')::time)/60;
     event_finish:=extract(epoch from (d->>'end_time')::time)/60;
     if night and event_start<shift_start then event_start:=event_start+1440;end if;
     if night and event_finish<shift_start then event_finish:=event_finish+1440;end if;
     if event_finish<=event_start or event_start<shift_start or event_finish>shift_finish then raise exception 'pr_downtime_schedule_invalid';end if;
     span:=int4range(event_start,event_finish,'[)');
     if exists(select 1 from unnest(seen) x where x && span) then raise exception 'pr_downtime_overlap';end if;
     seen:=array_append(seen,span);duration:=event_finish-event_start;
     d:=d||jsonb_build_object('minutes',duration);
    end if;
    events:=events||jsonb_build_array(d);
   end loop;
   payload:=payload||jsonb_build_object('downtime_events',events);
  end if;
 end if;
 v_id:=rls_internal.production_station_action_duration_core(p_action,payload);
 if p_action in ('save','submit') and p_data ? 'staff_names' then
  update public.production_station_reports set staff_names=btrim(coalesce(p_data->>'staff_names','')) where id=v_id;
 end if;
 return v_id;
end $function$
;
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
  select l.station_code,l.item_id,sum(l.quantity) as loaded_quantity,min(l.created_at) as tracked_at,
  15::numeric as alert_minutes,
  coalesce((select sum(u.quantity) from public.production_material_usages u where u.station_code=l.station_code and u.item_id=l.item_id),0) as confirmed_consumption,
  0::numeric as confirmed_baseline
  from public.production_material_loads l group by l.station_code,l.item_id
 ) m),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
  select lr.*,coalesce(sr.machine_quantity,0) as posted_quantity,
   coalesce((select jsonb_agg(jsonb_build_object('item_id',bl.ingredient_id,'per_unit',bl.quantity_per_unit*(1+bl.waste_rate))) from public.inventory_boms ib join public.inventory_bom_lines bl on bl.bom_id=ib.id join public.inventory_items i on i.id=bl.ingredient_id and i.category='RAW' where ib.finished_item_id=lr.item_id and ib.active and not ib.archived),'[]'::jsonb) as raw_recipe
  from public.production_live_runs lr left join public.production_station_reports sr on sr.live_run_id=lr.id and sr.status='posted' and sr.report_mode='production'
  where lr.deleted_at is null and (lr.closed_at is null or sr.id is null)
 ) r),'[]'::jsonb),
 'baselines',coalesce((select jsonb_agg(to_jsonb(b)) from public.production_material_baselines b),'[]'::jsonb),
 'wip',coalesce((select jsonb_agg(to_jsonb(w)) from (
  select sr.station_code,sr.item_id,sum(case when sr.report_mode='packing' then -sr.packed_quantity else sr.good_quantity-sr.packed_quantity end) quantity
  from public.production_station_reports sr where sr.status='posted' and not exists(select 1 from public.production_station_consumptions c where c.report_id=sr.id and c.source='repack') group by sr.station_code,sr.item_id
 ) w where w.quantity<>0),'[]'::jsonb),
 'loads',coalesce((select jsonb_agg(to_jsonb(l)) from (select ml.*,o.nombre as reporter_name from public.production_material_loads ml left join public.operadores o on o.uid=ml.created_by order by ml.created_at desc limit 100) l),'[]'::jsonb)
 );
end $function$
;
