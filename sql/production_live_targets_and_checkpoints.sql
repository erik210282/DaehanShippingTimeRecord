-- Live production monitoring: checkpoints never post inventory.
create table public.production_targets (
 item_id uuid primary key references public.inventory_items(id),
 pieces_per_hour numeric not null check(pieces_per_hour>0 and pieces_per_hour<=100000000),
 interval_hours integer not null default 2 check(interval_hours in (2,3)),
 warning_percent numeric not null default 90 check(warning_percent>0 and warning_percent<=100),
 critical_percent numeric not null default 75 check(critical_percent>0 and critical_percent<warning_percent),
 updated_by uuid not null, updated_at timestamptz not null default now()
);
create table public.production_live_runs (
 id uuid primary key, station_code text not null references public.inventory_workstations(code),
 item_id uuid not null references public.inventory_items(id), started_at timestamptz not null,
 created_by uuid not null, created_at timestamptz not null default now(), closed_at timestamptz,
 pieces_per_hour numeric not null, interval_hours integer not null,
 warning_percent numeric not null, critical_percent numeric not null,
 latest_quantity bigint not null default 0, latest_at timestamptz
);
create unique index production_one_active_station on public.production_live_runs(station_code) where closed_at is null;
create index production_live_runs_created_by on public.production_live_runs(created_by);
create index production_live_runs_item on public.production_live_runs(item_id);
create table public.production_checkpoints (
 id uuid primary key, run_id uuid not null references public.production_live_runs(id),
 recorded_at timestamptz not null default now(), quantity bigint not null check(quantity>=0),
 created_by uuid not null, expected_quantity numeric not null, attainment numeric not null,
 performance text not null check(performance in ('on_track','warning','critical'))
);
create index production_checkpoints_run_time on public.production_checkpoints(run_id,recorded_at desc);
alter table public.production_targets enable row level security;
alter table public.production_live_runs enable row level security;
alter table public.production_checkpoints enable row level security;
revoke all on public.production_targets,public.production_live_runs,public.production_checkpoints from public,anon,authenticated;

create function rls_internal.production_live_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare manager boolean;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
 (select r.*,c.expected_quantity,c.attainment,c.performance,
 (r.closed_at is null and now()>coalesce(r.latest_at,r.started_at)+make_interval(hours=>r.interval_hours)) as overdue
 from public.production_live_runs r left join lateral(select c.expected_quantity,c.attainment,c.performance from public.production_checkpoints c where c.run_id=r.id order by c.recorded_at desc limit 1)c on true
 where (manager or r.created_by=auth.uid()) and (r.closed_at is null or r.closed_at>now()-interval '7 days'))r),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c) order by c.recorded_at desc) from
 (select c.* from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where (manager or r.created_by=auth.uid()) and c.recorded_at>now()-interval '7 days' order by c.recorded_at desc limit 500)c),'[]'::jsonb));
end $$;

create function rls_internal.production_live_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();manager boolean;v_now timestamptz:=clock_timestamp();v_id uuid;v_item uuid;v_station text;v_start timestamptz;v_quantity bigint;v_expected numeric;v_attainment numeric;v_performance text;r public.production_live_runs;t public.production_targets;c public.production_checkpoints;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 if p_action='target' then
  if not manager then raise exception 'pr_forbidden';end if;
  v_item:=(p_data->>'item_id')::uuid;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in ('FG','SEMI')) then raise exception 'pr_item_required';end if;
  if coalesce(p_data->>'pieces_per_hour','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'interval_hours','') not in ('2','3') or coalesce(p_data->>'warning_percent','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_data->>'critical_percent','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'pl_target_invalid';end if;
  if (p_data->>'pieces_per_hour')::numeric<=0 or (p_data->>'pieces_per_hour')::numeric>100000000 or (p_data->>'warning_percent')::numeric>100 or (p_data->>'critical_percent')::numeric<=0 or (p_data->>'critical_percent')::numeric>=(p_data->>'warning_percent')::numeric then raise exception 'pl_target_invalid';end if;
  insert into public.production_targets(item_id,pieces_per_hour,interval_hours,warning_percent,critical_percent,updated_by,updated_at)
  values(v_item,(p_data->>'pieces_per_hour')::numeric,(p_data->>'interval_hours')::integer,(p_data->>'warning_percent')::numeric,(p_data->>'critical_percent')::numeric,uid,v_now)
  on conflict(item_id) do update set pieces_per_hour=excluded.pieces_per_hour,interval_hours=excluded.interval_hours,warning_percent=excluded.warning_percent,critical_percent=excluded.critical_percent,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='close' then
  select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
  if r.id is null or (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  update public.production_live_runs set closed_at=coalesce(closed_at,v_now) where id=r.id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action<>'checkpoint' then raise exception 'pr_invalid';end if;
 v_id:=(p_data->>'id')::uuid;
 if v_id is null then raise exception 'pr_invalid';end if;
 -- Serialize retries by request id before reading the saved result.
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
 select * into c from public.production_checkpoints where id=v_id;
 if c.id is not null then
  if c.created_by<>uid then raise exception 'pr_forbidden';end if;
  return to_jsonb(c);
 end if;
 if coalesce(p_data->>'quantity','') !~ '^[0-9]{1,12}$' then raise exception 'pl_quantity_invalid';end if;
 v_quantity:=(p_data->>'quantity')::bigint;
 select * into r from public.production_live_runs where id=(p_data->>'run_id')::uuid for update;
 if r.id is null then
  v_station:=p_data->>'station_code';v_item:=(p_data->>'item_id')::uuid;v_start:=(p_data->>'started_at')::timestamptz;
  if not exists(select 1 from public.inventory_workstations where code=v_station and active) then raise exception 'pr_station_required';end if;
  if not exists(select 1 from public.inventory_items where id=v_item and active and category in ('FG','SEMI')) then raise exception 'pr_item_required';end if;
  if v_start is null or v_start>=v_now or v_start<v_now-interval '24 hours' then raise exception 'pl_start_invalid';end if;
  select * into t from public.production_targets where item_id=v_item;
  if t.item_id is null then raise exception 'pl_target_missing';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_station,1));
  if exists(select 1 from public.production_live_runs where station_code=v_station and closed_at is null) then raise exception 'pl_station_busy';end if;
  insert into public.production_live_runs(id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent)
  values((p_data->>'run_id')::uuid,v_station,v_item,v_start,uid,t.pieces_per_hour,t.interval_hours,t.warning_percent,t.critical_percent) returning * into r;
 else
  if (not manager and r.created_by<>uid) then raise exception 'pr_forbidden';end if;
  if r.closed_at is not null then raise exception 'pl_run_closed';end if;
  if v_now>r.started_at+interval '24 hours' then raise exception 'pl_expired';end if;
  if v_quantity<r.latest_quantity then raise exception 'pl_quantity_invalid';end if;
 end if;
 v_expected:=r.pieces_per_hour*extract(epoch from(v_now-r.started_at))/3600;
 v_attainment:=v_quantity*100/nullif(v_expected,0);
 v_performance:=case when v_attainment<r.critical_percent then 'critical' when v_attainment<r.warning_percent then 'warning' else 'on_track' end;
 insert into public.production_checkpoints(id,run_id,recorded_at,quantity,created_by,expected_quantity,attainment,performance)
 values(v_id,r.id,v_now,v_quantity,uid,v_expected,v_attainment,v_performance) returning * into c;
 update public.production_live_runs set latest_quantity=v_quantity,latest_at=v_now where id=r.id;
 return to_jsonb(c);
end $$;
create function public.production_live_snapshot() returns jsonb language sql set search_path='' as $$select rls_internal.production_live_snapshot();$$;
create function public.production_live_action(p_action text,p_data jsonb) returns jsonb language sql set search_path='' as $$select rls_internal.production_live_action($1,$2);$$;
revoke all on function public.production_live_snapshot(),public.production_live_action(text,jsonb),rls_internal.production_live_snapshot(),rls_internal.production_live_action(text,jsonb) from public,anon;
grant execute on function public.production_live_snapshot(),public.production_live_action(text,jsonb),rls_internal.production_live_snapshot(),rls_internal.production_live_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
create policy production_targets_rpc_only on public.production_targets for all to authenticated using(false) with check(false);
create policy production_live_runs_rpc_only on public.production_live_runs for all to authenticated using(false) with check(false);
create policy production_checkpoints_rpc_only on public.production_checkpoints for all to authenticated using(false) with check(false);