begin;
select set_config('request.jwt.claims','{"sub":"270a4a29-8fe0-4eee-8267-9e797be33216","role":"authenticated"}',true);
do $t$
declare station text;item uuid;request uuid:=gen_random_uuid();p jsonb;started timestamptz:=now()+interval '60 days';run public.production_live_runs;
begin
 select w.code into station from public.inventory_workstations w where w.active and not exists(select 1 from public.production_live_runs r where r.station_code=w.code and r.deleted_at is null and r.closed_at is null) limit 1;
 select t.item_id into item from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.deleted_at is null and i.active limit 1;
 p:=jsonb_build_object('id',request,'started_at',started,'shift_hours',8,'planned_hours',12,'stations',jsonb_build_array(jsonb_build_object('station_code',station,'item_ids',jsonb_build_array(item))));
 perform public.production_schedule_action('save',p);
 begin
  perform public.production_schedule_action('save',p||jsonb_build_object('id',gen_random_uuid(),'started_at',started+interval '10 hours'));
  raise exception 'Custom overlap accepted';
 exception when others then if sqlerrm<>'ps_schedule_overlap' then raise;end if;end;
 begin
  perform public.production_schedule_action('save',p||jsonb_build_object('id',gen_random_uuid(),'planned_hours',25));
  raise exception 'Invalid hours accepted';
 exception when others then if sqlerrm<>'pl_start_invalid' then raise;end if;end;
 perform public.production_supply_action('start',p||jsonb_build_object('id',gen_random_uuid(),'started_at',now()-interval '10 minutes'));
 select r.* into run from public.production_live_runs r where r.station_code=station and r.created_by=auth.uid() and r.closed_at is null and r.deleted_at is null order by r.started_at desc limit 1;
 if run.planned_hours<>12 or run.shift_hours<>8 then raise exception 'Custom hours lost';end if;
 if abs(run.pieces_per_hour-(select target_8h/7.5 from public.production_targets where item_id=item))>0.001 then raise exception 'UPH reference changed';end if;
end $t$;
rollback;