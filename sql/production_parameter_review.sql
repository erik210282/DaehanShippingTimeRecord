alter table public.production_parameter_requests add column if not exists version integer not null default 1;
alter table public.production_parameter_requests add column if not exists updated_by uuid references auth.users(id);
alter table public.production_parameter_requests add column if not exists updated_at timestamptz;
alter table public.production_parameter_requests add column if not exists deleted_by uuid references auth.users(id);
alter table public.production_parameter_requests add column if not exists deleted_at timestamptz;
create or replace function rls_internal.production_parameter_review(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.production_parameter_requests;report public.production_parameter_checks;field jsonb;entry jsonb;new_readings jsonb:='[]';value text;quantity numeric;lo numeric;hi numeric;outside boolean:=false;recorded timestamptz;local_at timestamp;
begin
 if not public.inventory_access('production',true) or not rls_internal.role_activity_access('production','parameters') then raise exception 'ra_denied';end if;
 select * into req from public.production_parameter_requests where id=(p_data->>'id')::uuid for update;
 if req.id is null or req.deleted_at is not null or req.version is distinct from (p_data->>'version')::integer then raise exception 'pp_changed';end if;
 if p_action='delete' then
  update public.production_parameter_requests set deleted_at=now(),deleted_by=auth.uid(),version=version+1 where id=req.id;
 elsif p_action='edit' then
  select * into report from public.production_parameter_checks where capture_group_id=req.id order by id limit 1;
  if report.id is null or coalesce(p_data->>'time','') !~ '^(0[0-9]|1[0-9]|2[0-3])[0-5][0-9]$' or coalesce(p_data->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or length(coalesce(p_data->>'note',''))>2000 then raise exception 'pr_time_invalid';end if;
  local_at:=((p_data->>'date')||' '||substr(p_data->>'time',1,2)||':'||substr(p_data->>'time',3,2))::timestamp;
  recorded:=local_at at time zone report.timezone;
  if recorded>clock_timestamp()+interval '1 minute' or (recorded at time zone report.timezone)<>local_at then raise exception 'pr_time_invalid';end if;
  if jsonb_typeof(p_data->'values') is distinct from 'array' or jsonb_array_length(p_data->'values')<>jsonb_array_length(report.readings) then raise exception 'pp_values_required';end if;
  for field in select jsonb_array_elements(report.readings) loop
   if (select count(*) from jsonb_array_elements(p_data->'values')x where x->>'id'=field->>'id')<>1 then raise exception 'pp_values_required';end if;
   select x into entry from jsonb_array_elements(p_data->'values')x where x->>'id'=field->>'id';value:=trim(coalesce(entry->>'value',''));
   if length(value) not between 1 and 500 or length(coalesce(entry->>'note',''))>1000 then raise exception 'pp_values_required';end if;
   lo:=nullif(field->>'minimum','')::numeric;hi:=nullif(field->>'maximum','')::numeric;
   if field->>'input_type'='numeric' then if value !~ '^-?[0-9]+([.][0-9]+)?$' then raise exception 'pp_values_required';end if;quantity:=value::numeric;else quantity:=null;end if;
   outside:=outside or coalesce(quantity<lo or quantity>hi,false);
   new_readings:=new_readings||jsonb_build_array(field||jsonb_build_object('value',value,'note',coalesce(entry->>'note',''),'out_of_range',coalesce(quantity<lo or quantity>hi,false)));
  end loop;
  update public.production_parameter_checks set recorded_at=recorded,recorded_date=local_at::date,recorded_time=local_at::time,readings=new_readings,note=coalesce(p_data->>'note',''),out_of_range=outside where capture_group_id=req.id;
  update public.production_parameter_requests set version=version+1,updated_at=now(),updated_by=auth.uid() where id=req.id;
 else raise exception 'pp_invalid';end if;
 return jsonb_build_object('saved',true);
end $$;
create or replace function public.production_parameter_review(p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $$select rls_internal.production_parameter_review(p_action,p_data)$$;
revoke all on function public.production_parameter_review(text,jsonb),rls_internal.production_parameter_review(text,jsonb) from public,anon;
grant execute on function public.production_parameter_review(text,jsonb),rls_internal.production_parameter_review(text,jsonb) to authenticated;

create or replace function rls_internal.production_parameter_snapshot(p_from date,p_to date,p_station text default '',p_search text default '',p_outside boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare manager boolean; reports jsonb; total integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or length(coalesce(p_search,''))>100 then raise exception 'pr_time_invalid';end if;
 manager:=public.inventory_access('production',true);
 with base as (
  select c.*,req.version as capture_version,req.updated_at,req.updated_by,(select nombre from public.operadores where uid=req.updated_by limit 1) as updated_by_name,case when jsonb_array_length(c.products)>0 then c.products else
   jsonb_agg(jsonb_build_object('item_id',c.item_id,'part_number',c.part_number,'part_name',c.part_name)) over(partition by c.capture_group_id order by c.part_number,c.id rows between unbounded preceding and unbounded following) end as capture_products
  from public.production_parameter_checks c join public.production_parameter_requests req on req.id=c.capture_group_id where req.deleted_at is null and (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station)
 ), grouped as (
  select distinct on(capture_group_id) * from base order by capture_group_id,id
 ), eligible as (
  select (to_jsonb(g)-'capture_products')||jsonb_build_object('products',g.capture_products,
    'part_number',(select string_agg(x->>'part_number',' / ') from jsonb_array_elements(g.capture_products) x),
    'part_name',(select string_agg(x->>'part_name',' / ') from jsonb_array_elements(g.capture_products) x)) as report,g.recorded_at,g.id
  from grouped g where (coalesce(p_search,'')='' or concat_ws(' ',g.capture_products::text,g.leader_name,g.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or g.out_of_range)
 ) select (select count(*) from eligible),coalesce((select jsonb_agg(x.report order by x.recorded_at desc,x.id) from (select * from eligible order by recorded_at desc,id limit 500)x),'[]') into total,reports;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t),'reports',reports,'total',total);
end $$;
