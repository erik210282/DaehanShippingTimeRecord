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
