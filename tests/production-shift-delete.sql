
begin;
insert into public.machine_types(name) values('test') on conflict do nothing;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare item uuid:=gen_random_uuid();station text:='DELETE-TEST-'||gen_random_uuid();request uuid:=gen_random_uuid();r uuid;session uuid;cp uuid:=gen_random_uuid();
begin
 insert into public.inventory_items(id,part_number,category) values(item,'DELETE-'||item,'SEMI');
 insert into public.inventory_workstations(code,name,machine_type) values(station,'Delete test','test');
 perform public.production_live_action('target',jsonb_build_object('item_id',item,'target_8h',750,'target_10h',930,'warning_percent',90,'critical_percent',75));
 perform public.production_supply_action('start',jsonb_build_object('id',request,'started_at',clock_timestamp()-interval '2 hours','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station,'item_ids',jsonb_build_array(item)))));
 select id,session_id into r,session from public.production_live_runs where shift_start_id=request;
 perform public.production_live_action('checkpoint',jsonb_build_object('id',cp,'run_id',r,'quantity',10));
 perform public.production_live_action('delete_checkpoint',jsonb_build_object('id',cp));
 if (select deleted_at from public.production_live_runs where id=r) is not null then raise exception 'progress deleted run';end if;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 begin
  perform public.production_delete_shift(session);
  raise exception 'operator deleted shift';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 perform public.production_delete_shift(session);
 if (select deleted_at from public.production_live_runs where id=r) is null then raise exception 'explicit shift delete failed';end if;
end $test$;
rollback;