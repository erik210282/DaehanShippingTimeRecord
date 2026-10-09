
alter table public.production_targets add column target_8h bigint, add column target_10h bigint, add column deleted_at timestamptz;
update public.production_targets set target_8h=greatest(1,round(pieces_per_hour*8)),target_10h=greatest(1,round(pieces_per_hour*10)) where target_8h is null;
alter table public.production_targets alter column target_8h set not null,alter column target_10h set not null;
alter table public.production_targets add constraint production_shift_targets_positive check(target_8h>0 and target_10h>0);
alter table public.production_live_runs add column shift_hours integer not null default 8 check(shift_hours in(8,10)),add column shift_target numeric,add column deleted_at timestamptz,add column updated_at timestamptz,add column updated_by uuid;
update public.production_live_runs set shift_target=pieces_per_hour*8 where shift_target is null;
alter table public.production_live_runs alter column shift_target set not null;
alter table public.production_checkpoints add column deleted_at timestamptz,add column updated_at timestamptz,add column updated_by uuid;
drop index public.production_one_active_station;
create unique index production_one_active_station on public.production_live_runs(station_code) where closed_at is null and deleted_at is null;

create function rls_internal.production_live_recalculate(p_run uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.production_live_runs;c public.production_checkpoints;
begin
 select * into r from public.production_live_runs where id=p_run for update;
 if exists(select 1 from (select quantity,lag(quantity) over(order by recorded_at,id) previous from public.production_checkpoints where run_id=p_run and deleted_at is null)x where quantity<previous) then raise exception 'pl_quantity_invalid';end if;
 if exists(select 1 from public.production_checkpoints where run_id=p_run and deleted_at is null and recorded_at<=r.started_at) then raise exception 'pl_start_invalid';end if;
 update public.production_checkpoints set expected_quantity=r.shift_target*least(r.shift_hours,extract(epoch from(recorded_at-r.started_at))/3600)/r.shift_hours where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set attainment=quantity*100/expected_quantity where run_id=p_run and deleted_at is null;
 update public.production_checkpoints set performance=case when attainment<r.critical_percent then 'critical' when attainment<r.warning_percent then 'warning' else 'on_track' end where run_id=p_run and deleted_at is null;
 select * into c from public.production_checkpoints where run_id=p_run and deleted_at is null order by recorded_at desc,id desc limit 1;
 update public.production_live_runs set latest_quantity=coalesce(c.quantity,0),latest_at=c.recorded_at where id=p_run;
end $$;
revoke all on function rls_internal.production_live_recalculate(uuid) from public,anon,authenticated;

create or replace function rls_internal.production_live_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();manager boolean;v_now timestamptz:=clock_timestamp();v_id uuid;v_item uuid;v_station text;v_start timestamptz;v_quantity bigint;v_hours integer;v_target numeric;r public.production_live_runs;t public.production_targets;c public.production_checkpoints;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 if p_action in('target','delete_target','restore_target') then
  if not manager then raise exception 'pr_forbidden';end if;
  v_item:=(p_data->>'item_id')::uuid;
  if p_action<>'target' then
   update public.production_targets set deleted_at=case when p_action='delete_target' then v_now else null end,updated_by=uid,updated_at=v_now where item_id=v_item;
   return jsonb_build_object('saved',true);
  end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  -- Preserve compatibility with installed older mobile clients during rollout.
  if p_data ? 'target_8h' then
   if coalesce(p_data->>'target_8h','') !~ '^[0-9]{1,9}$' or coalesce(p_data->>'target_10h','') !~ '^[0-9]{1,9}$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=(p_data->>'target_8h')::bigint;t.target_10h:=(p_data->>'target_10h')::bigint;
  else
   if coalesce(p_data->>'pieces_per_hour','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
   t.target_8h:=round((p_data->>'pieces_per_hour')::numeric*8);t.target_10h:=round((p_data->>'pieces_per_hour')::numeric*10);
  end if;
  if coalesce(p_data->>'warning_percent','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'critical_percent','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
  t.warning_percent:=(p_data->>'warning_percent')::numeric;t.critical_percent:=(p_data->>'critical_percent')::numeric;
  if t.target_8h<=0 or t.target_10h<=0 or t.target_8h>100000000 or t.target_10h>100000000 or t.warning_percent>100 or t.critical_percent<=0 or t.critical_percent>=t.warning_percent then raise exception 'pl_target_invalid';end if;
  insert into public.production_targets(item_id,target_8h,target_10h,pieces_per_hour,interval_hours,warning_percent,critical_percent,updated_by,updated_at)
  values(v_item,t.target_8h,t.target_10h,t.target_8h::numeric/8,2,t.warning_percent,t.critical_percent,uid,v_now)
  on conflict(item_id) do update set target_8h=excluded.target_8h,target_10h=excluded.target_10h,pieces_per_hour=excluded.pieces_per_hour,warning_percent=excluded.warning_percent,critical_percent=excluded.critical_percent,updated_by=uid,updated_at=v_now,deleted_at=null;
  return jsonb_build_object('saved',true);
 end if;
 if p_action in('edit_checkpoint','delete_checkpoint','restore_checkpoint') then
  v_id:=(p_data->>'id')::uuid;
  select * into c from public.production_checkpoints where id=v_id;
  if c.id is null then raise exception 'pr_invalid';end if;
  select * into r from public.production_live_runs where id=c.run_id for update;
  if r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='edit_checkpoint' then
   if c.deleted_at is not null then raise exception 'pl_report_deleted';end if;
   if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
   update public.production_checkpoints set quantity=(p_data->>'quantity')::bigint,updated_at=v_now,updated_by=uid where id=v_id;
  else
   update public.production_checkpoints set deleted_at=case when p_action='delete_checkpoint' then v_now else null end,updated_at=v_now,updated_by=uid where id=v_id;
  end if;
  perform rls_internal.production_live_recalculate(r.id);
  select * into c from public.production_checkpoints where id=v_id;
  return to_jsonb(c);
 end if;
 if p_action in('close','edit_run','delete_run','restore_run') then
  select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
  if r.id is null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if p_action='delete_run' then
   update public.production_live_runs set deleted_at=v_now,updated_at=v_now,updated_by=uid where id=r.id;
  elsif p_action='restore_run' then
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=r.station_code and id<>r.id and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   update public.production_live_runs set deleted_at=null,updated_at=v_now,updated_by=uid where id=r.id;
  elsif r.deleted_at is not null then raise exception 'pl_report_deleted';
  elsif p_action='close' then
   update public.production_live_runs set closed_at=coalesce(closed_at,v_now),updated_at=v_now,updated_by=uid where id=r.id;
  else
   v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=(p_data->>'shift_hours')::integer;
   if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
   if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
   if v_start is null or v_start>=coalesce((select min(recorded_at) from public.production_checkpoints where run_id=r.id and deleted_at is null),v_now) or v_hours not in(8,10) or v_hours is null then raise exception 'pl_start_invalid';end if;
   if r.closed_at is null and exists(select 1 from public.production_live_runs where station_code=v_station and id<>r.id and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
   if r.item_id<>v_item or r.shift_hours<>v_hours then
    select * into t from public.production_targets where item_id=v_item and deleted_at is null;
    if t.item_id is null then raise exception 'pl_target_missing';end if;
    v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
   else v_target:=r.shift_target;end if;
   update public.production_live_runs set station_code=v_station,item_id=v_item,started_at=v_start,shift_hours=v_hours,shift_target=v_target,pieces_per_hour=v_target/v_hours,warning_percent=case when r.item_id<>v_item then t.warning_percent else r.warning_percent end,critical_percent=case when r.item_id<>v_item then t.critical_percent else r.critical_percent end,updated_at=v_now,updated_by=uid where id=r.id;
   perform rls_internal.production_live_recalculate(r.id);
  end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_action is distinct from 'checkpoint' then raise exception 'pr_invalid';end if;
 v_id:=(p_data->>'id')::uuid;
 if v_id is null then raise exception 'pr_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
 select * into c from public.production_checkpoints where id=v_id;
 if c.id is not null then
  if c.created_by<>uid then raise exception 'pr_forbidden';end if;
  if c.deleted_at is not null or exists(select 1 from public.production_live_runs where id=c.run_id and deleted_at is not null) then raise exception 'pl_report_deleted';end if;
  return to_jsonb(c);
 end if;
 if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
 v_quantity:=(p_data->>'quantity')::bigint;
 select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
 if r.id is null then
  v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;v_hours:=coalesce((p_data->>'shift_hours')::integer,8);
  if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in('FG','SEMI')) then raise exception 'pr_item_required';end if;
  if v_start is null or v_start>=v_now or v_start<v_now-interval '24 hours' or v_hours not in(8,10) then raise exception 'pl_start_invalid';end if;
  select * into t from public.production_targets where item_id=v_item and deleted_at is null;
  if t.item_id is null then raise exception 'pl_target_missing';end if;
  v_target:=case when v_hours=8 then t.target_8h else t.target_10h end;
  perform pg_advisory_xact_lock(hashtextextended(v_station,1));
  if exists(select 1 from public.production_live_runs where station_code=v_station and closed_at is null and deleted_at is null) then raise exception 'pl_station_busy';end if;
  insert into public.production_live_runs(id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
  values((p_data->>'run_id')::uuid,v_station,v_item,v_start,uid,v_target/v_hours,2,t.warning_percent,t.critical_percent,v_hours,v_target) returning * into r;
 else
  if r.deleted_at is not null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if v_now>r.started_at+interval '24 hours' then raise exception 'pl_expired';end if;
  if v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
 end if;
 insert into public.production_checkpoints(id,run_id,recorded_at,quantity,created_by,expected_quantity,attainment,performance)
 values(v_id,r.id,v_now,v_quantity,uid,1,0,'on_track') returning * into c;
 perform rls_internal.production_live_recalculate(r.id);
 select * into c from public.production_checkpoints where id=v_id;
 return to_jsonb(c);
end $$;

create function rls_internal.production_live_snapshot_range(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare manager boolean;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '48 hours' then raise exception 'pr_invalid';end if;
 manager:=public.inventory_access('production',true);
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null and(manager or r.created_by=auth.uid()) and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null and(manager or r.created_by=auth.uid()) and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $$;
create function public.production_live_snapshot_range(p_from timestamptz,p_to timestamptz) returns jsonb language sql set search_path='' as $$select rls_internal.production_live_snapshot_range($1,$2);$$;
revoke all on function public.production_live_snapshot_range(timestamptz,timestamptz),rls_internal.production_live_snapshot_range(timestamptz,timestamptz) from public,anon;
grant execute on function public.production_live_snapshot_range(timestamptz,timestamptz),rls_internal.production_live_snapshot_range(timestamptz,timestamptz) to authenticated;
create or replace function rls_internal.production_live_snapshot() returns jsonb language sql security definer set search_path='' as $$select rls_internal.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');$$;
notify pgrst,'reload schema';
