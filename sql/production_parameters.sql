
create table public.production_parameter_templates(
 id uuid primary key, name text not null check(length(trim(name)) between 1 and 120),
 machine_types text[] not null, station_code text references public.inventory_workstations(code),
 item_id uuid references public.inventory_items(id), fields jsonb not null,
 version integer not null default 1, active boolean not null default true,
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.production_parameter_requests(
 id uuid primary key, payload jsonb not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.production_parameter_checks(
 id uuid primary key default gen_random_uuid(), capture_group_id uuid not null references public.production_parameter_requests(id),
 station_code text not null references public.inventory_workstations(code), item_id uuid not null references public.inventory_items(id),
 template_id uuid not null references public.production_parameter_templates(id), template_version integer not null,
 recorded_at timestamptz not null, recorded_date date not null, recorded_time time not null, timezone text not null,
 shift text not null default '', leader_id uuid not null references auth.users(id), leader_name text not null,
 station_name text not null, part_number text not null, part_name text not null, template_name text not null,
 readings jsonb not null, note text not null default '', out_of_range boolean not null,
 created_at timestamptz not null default now(), unique(capture_group_id,item_id)
);
create index production_parameter_checks_date on public.production_parameter_checks(recorded_date desc,recorded_at desc);
create index production_parameter_checks_station on public.production_parameter_checks(station_code,recorded_date desc);
create index production_parameter_checks_leader on public.production_parameter_checks(leader_id,recorded_date desc);
alter table public.production_parameter_templates enable row level security;
alter table public.production_parameter_requests enable row level security;
alter table public.production_parameter_checks enable row level security;
revoke all on public.production_parameter_templates,public.production_parameter_requests,public.production_parameter_checks from anon,authenticated;
grant select on public.production_parameter_templates,public.production_parameter_checks to authenticated;
create policy production_parameter_templates_read on public.production_parameter_templates for select to authenticated using ((select public.inventory_access('production')));
create policy production_parameter_request_owner on public.production_parameter_requests for select to authenticated using (created_by=(select auth.uid()) and (select public.inventory_access('production')));
create policy production_parameter_checks_read on public.production_parameter_checks for select to authenticated using ((select public.inventory_access('production')) and ((select public.inventory_access('production',true)) or leader_id=(select auth.uid())));
create trigger production_parameter_templates_changed after insert or update or delete on public.production_parameter_templates for each statement execute function rls_internal.notify_catalog_update();
create trigger production_parameter_checks_changed after insert or update or delete on public.production_parameter_checks for each statement execute function rls_internal.notify_catalog_update();

create or replace function rls_internal.production_parameter_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();manager boolean;leader boolean;request uuid:=(p_data->>'id')::uuid;
 tpl public.production_parameter_templates; old_request public.production_parameter_requests;
 station public.inventory_workstations; product public.inventory_items; field jsonb; entry jsonb; readings jsonb:='[]';
 fields jsonb; names text[]:='{}'; field_id text; value text; quantity numeric; lo numeric; hi numeric; outside boolean:=false;
 recorded timestamptz; zone text; local_at timestamp; leader_name text; part_name text; item text;
begin
 if uid is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 manager:=public.inventory_access('production',true);
 leader:=manager or exists(select 1 from public.global_department_memberships where user_id=uid and department='production' and active and role='lider');
 if request is null then raise exception 'pp_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('parameter:'||request,0));
 if p_action='template' then
  if not manager then raise exception 'pr_forbidden';end if;
  select * into tpl from public.production_parameter_templates where id=request for update;
  if tpl.id is not null and tpl.version is distinct from (p_data->>'version')::integer then raise exception 'pp_changed';end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 120 or jsonb_typeof(p_data->'machine_types') is distinct from 'array' or jsonb_array_length(p_data->'machine_types') not between 1 and 20 then raise exception 'pp_invalid';end if;
  for item in select jsonb_array_elements_text(p_data->'machine_types') loop
   if length(trim(item)) not between 1 and 100 then raise exception 'pp_invalid';end if;
  end loop;
  if nullif(p_data->>'station_code','') is not null and not exists(select 1 from public.inventory_workstations where code=p_data->>'station_code' and active and machine_type in(select jsonb_array_elements_text(p_data->'machine_types'))) then raise exception 'pr_station_required';end if;
  if nullif(p_data->>'item_id','') is not null and not exists(select 1 from public.inventory_items where id=(p_data->>'item_id')::uuid and active and category in ('FG','SEMI')) then raise exception 'pr_item_required';end if;
  fields:=p_data->'fields';
  if jsonb_typeof(fields) is distinct from 'array' or jsonb_array_length(fields) not between 1 and 100 then raise exception 'pp_invalid';end if;
  for field in select jsonb_array_elements(fields) loop
   field_id:=field->>'id';
   if field_id is null or field_id=any(names) or length(field_id) not between 1 and 100 or length(trim(coalesce(field->>'label',''))) not between 1 and 120 or field->>'input_type' is null or field->>'input_type' not in ('numeric','text') or length(coalesce(field->>'unit',''))>30 or length(coalesce(field->>'reference',''))>200 then raise exception 'pp_invalid';end if;
   names:=array_append(names,field_id);
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if lo is not null and lo::text in ('NaN','Infinity','-Infinity') or hi is not null and hi::text in ('NaN','Infinity','-Infinity') or lo>hi or (field->>'input_type'='text' and (lo is not null or hi is not null)) then raise exception 'pp_invalid';end if;
  end loop;
  insert into public.production_parameter_templates(id,name,machine_types,station_code,item_id,fields,created_by,updated_by)
   values(request,trim(p_data->>'name'),array(select distinct jsonb_array_elements_text(p_data->'machine_types')),nullif(p_data->>'station_code',''),nullif(p_data->>'item_id','')::uuid,fields,uid,uid)
  on conflict(id) do update set name=excluded.name,machine_types=excluded.machine_types,station_code=excluded.station_code,item_id=excluded.item_id,fields=excluded.fields,version=public.production_parameter_templates.version+1,active=coalesce((p_data->>'active')::boolean,true),updated_by=uid,updated_at=now();
 elsif p_action='archive' then
  if not manager then raise exception 'pr_forbidden';end if;
  update public.production_parameter_templates set active=false,version=version+1,updated_by=uid,updated_at=now() where id=request and version=(p_data->>'version')::integer;
  if not found then raise exception 'pp_changed';end if;
 elsif p_action='capture' then
  if not leader then raise exception 'pr_forbidden';end if;
  select * into old_request from public.production_parameter_requests where id=request;
  if old_request.id is not null then
   if old_request.created_by<>uid or old_request.payload<>p_data then raise exception 'pp_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  select * into station from public.inventory_workstations where code=p_data->>'station_code' and active;
  if station.code is null then raise exception 'pr_station_required';end if;
  select * into tpl from public.production_parameter_templates where id=(p_data->>'template_id')::uuid and active for share;
  if tpl.id is null or tpl.version is distinct from (p_data->>'template_version')::integer then raise exception 'pp_changed';end if;
  if not (station.machine_type=any(tpl.machine_types)) or tpl.station_code is not null and tpl.station_code<>station.code then raise exception 'pp_invalid';end if;
  recorded:=nullif(p_data->>'recorded_at','')::timestamptz;zone:=p_data->>'timezone';
  if recorded is null or recorded>clock_timestamp()+interval '1 minute' or zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
  local_at:=recorded at time zone zone;
  -- Qualify the caller variable to avoid confusing it with the profile column.
  select o.nombre into leader_name from public.operadores o where o.uid=auth.uid() limit 1;
  if nullif(trim(leader_name),'') is null then raise exception 'pp_leader_missing';end if;
  if jsonb_typeof(p_data->'values') is distinct from 'array' or jsonb_array_length(p_data->'values')<>jsonb_array_length(tpl.fields) then raise exception 'pp_values_required';end if;
  for field in select jsonb_array_elements(tpl.fields) loop
   if (select count(*) from jsonb_array_elements(p_data->'values') x where x->>'id'=field->>'id')<>1 then raise exception 'pp_values_required';end if;
   select x into entry from jsonb_array_elements(p_data->'values') x where x->>'id'=field->>'id';
   value:=trim(coalesce(entry->>'value',''));
   if length(value) not between 1 and 500 or length(coalesce(entry->>'note',''))>1000 then raise exception 'pp_values_required';end if;
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if field->>'input_type'='numeric' then
    if value !~ '^-?[0-9]+([.][0-9]+)?$' then raise exception 'pp_values_required';end if;
    quantity:=value::numeric;
   else quantity:=null;
   end if;
   outside:=outside or coalesce(quantity<lo or quantity>hi,false);
   readings:=readings||jsonb_build_array(field||jsonb_build_object('value',value,'note',coalesce(entry->>'note',''),'out_of_range',coalesce(quantity<lo or quantity>hi,false)));
  end loop;
  if jsonb_typeof(p_data->'item_ids') is distinct from 'array' or jsonb_array_length(p_data->'item_ids') not between 1 and 30 or (select count(distinct x) from jsonb_array_elements_text(p_data->'item_ids') x)<>jsonb_array_length(p_data->'item_ids') or length(coalesce(p_data->>'shift',''))>30 or length(coalesce(p_data->>'note',''))>2000 then raise exception 'pp_invalid';end if;
  insert into public.production_parameter_requests(id,payload,created_by) values(request,p_data,uid);
  for item in select jsonb_array_elements_text(p_data->'item_ids') loop
   select * into product from public.inventory_items where id=item::uuid and active and category in ('FG','SEMI');
   if product.id is null or tpl.item_id is not null and tpl.item_id<>product.id then raise exception 'pr_item_required';end if;
   select coalesce(p.nombre,product.part_name,product.description,'') into part_name from (select 1) dummy left join public.productos p on p.id=product.producto_id;
   insert into public.production_parameter_checks(capture_group_id,station_code,item_id,template_id,template_version,recorded_at,recorded_date,recorded_time,timezone,shift,leader_id,leader_name,station_name,part_number,part_name,template_name,readings,note,out_of_range)
   values(request,station.code,product.id,tpl.id,tpl.version,recorded,local_at::date,local_at::time,zone,coalesce(p_data->>'shift',''),uid,leader_name,station.name,product.part_number,part_name,tpl.name,readings,coalesce(p_data->>'note',''),outside);
  end loop;
 else raise exception 'pp_invalid';
 end if;
 return jsonb_build_object('saved',true);
end $$;
create or replace function public.production_parameter_action(p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $$ select rls_internal.production_parameter_action(p_action,p_data) $$;
revoke all on function public.production_parameter_action(text,jsonb),rls_internal.production_parameter_action(text,jsonb) from public,anon;
grant execute on function public.production_parameter_action(text,jsonb),rls_internal.production_parameter_action(text,jsonb) to authenticated;

