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
