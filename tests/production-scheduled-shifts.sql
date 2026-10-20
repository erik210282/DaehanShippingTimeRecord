begin;
select set_config('request.jwt.claims','{"sub":"270a4a29-8fe0-4eee-8267-9e797be33216","role":"authenticated"}',true);
do $t$
declare code text; item uuid; request uuid:=gen_random_uuid(); test_payload jsonb; response jsonb;
begin
 select w.code into code from public.inventory_workstations w where w.active and not exists(select 1 from public.production_live_runs r where r.station_code=w.code and r.deleted_at is null and r.closed_at is null) limit 1;
 select t.item_id into item from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.deleted_at is null and i.active limit 1;
 if code is null or item is null then raise exception 'Missing test fixture';end if;
 test_payload:=jsonb_build_object('id',request,'started_at',now()+interval '1 day','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',code,'item_ids',jsonb_build_array(item))));
 perform public.production_schedule_action('save',test_payload);
 if exists(select 1 from public.production_live_runs where shift_start_id=request) then raise exception 'Schedule started too early';end if;
 begin
 perform public.production_schedule_action('save',test_payload||jsonb_build_object('id',gen_random_uuid()));
 raise exception 'Overlap accepted';
 exception when others then if sqlerrm<>'ps_schedule_overlap' then raise;end if;end;
 update public.production_shift_schedule set payload=test_payload||jsonb_build_object('started_at',now()-interval '1 minute'),started_at=now()-interval '1 minute' where id=request;
 perform rls_internal.production_process_schedule();
 if not exists(select 1 from public.production_shift_schedule where id=request and status='started') then raise exception 'Start failed: %',(select error_code from public.production_shift_schedule where id=request);end if;
 if (select count(*) from public.production_live_runs where shift_start_id=request)<>1 then raise exception 'Wrong run count';end if;
 perform rls_internal.production_process_schedule();
 if (select count(*) from public.production_live_runs where shift_start_id=request)<>1 then raise exception 'Duplicate start';end if;
 perform public.production_live_snapshot_range(now()-interval '30 days',now());
end $t$;
rollback;