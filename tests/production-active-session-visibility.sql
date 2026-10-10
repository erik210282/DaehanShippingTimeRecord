begin;
do $$
declare v_id uuid:=gen_random_uuid(); source public.production_live_runs; snap jsonb; action text;
begin
 select * into source from public.production_live_runs where created_by='270a4a29-8fe0-4eee-8267-9e797be33216' order by created_at desc limit 1;
 assert source.id is not null,'A supervisor session fixture is required';
 insert into public.production_live_runs(id,station_code,item_id,started_at,created_by,pieces_per_hour,interval_hours,warning_percent,critical_percent,shift_hours,shift_target)
 values(v_id,source.station_code,source.item_id,now()-interval '1 hour',source.created_by,source.pieces_per_hour,source.interval_hours,source.warning_percent,source.critical_percent,source.shift_hours,source.shift_target);
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 snap:=public.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
 assert exists(select 1 from jsonb_array_elements(snap->'runs') r where r->>'id'=v_id::text and r->>'can_continue'='true'),'Another production member must see the active station with continuation access';
 foreach action in array array['edit_run','delete_run'] loop
  begin
   perform public.production_live_action(action,jsonb_build_object('run_id',v_id,'id',gen_random_uuid(),'quantity','0'));
   raise exception 'Unexpected permission for %',action;
  exception when others then
   if sqlerrm<>'pr_forbidden' then raise;end if;
  end;
 end loop;
 update public.production_live_runs set closed_at=now() where id=v_id;
 snap:=public.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
 assert exists(select 1 from jsonb_array_elements(snap->'runs') r where r->>'id'=v_id::text),'Department members see closed sessions for handoff history';
 update public.production_live_runs set closed_at=null,created_by='9c45902c-ee83-4716-9f70-d8e7fe8e8b0d' where id=v_id;
 snap:=public.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
 assert exists(select 1 from jsonb_array_elements(snap->'runs') r where r->>'id'=v_id::text and r->>'can_manage'='true'),'The owner retains management';
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 snap:=public.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
 assert exists(select 1 from jsonb_array_elements(snap->'runs') r where r->>'id'=v_id::text and r->>'can_manage'='true'),'Supervisor retains management';
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.production_live_snapshot_range(date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
  raise exception 'Anonymous access unexpectedly allowed';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
end $$;
select 'PASS: shared active sessions visible; ownership, supervisor, closed-history and anonymous restrictions preserved' as result;
rollback;
