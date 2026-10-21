begin;
-- Set test.production_user to an authorized supervisor/leader UUID before running.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.production_user'),'role','authenticated')::text,true);
do $test$
declare station_codes text[]; product uuid; start_at timestamptz:=date_trunc('day',now()+interval '180 days')+interval '6 hours'; failed boolean;
begin
 select array_agg(code) into station_codes from (select code from public.inventory_workstations where active order by code limit 2) w;
 select t.item_id into product from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.deleted_at is null and i.active and i.category in('FG','SEMI') limit 1;
 if array_length(station_codes,1)<2 or product is null then raise exception 'missing fixture';end if;
 perform public.production_schedule_action('save',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at,'shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[1],'item_ids',jsonb_build_array(product)))));
 failed:=false;
 begin
 perform public.production_schedule_action('save',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at+interval '8 hours 15 minutes','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[1],'item_ids',jsonb_build_array(product)))));
 exception when others then if sqlerrm<>'ps_schedule_overlap' then raise;end if;failed:=true;end;
 if not failed then raise exception 'Lunch overlap accepted';end if;
 perform public.production_schedule_action('save',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at+interval '8 hours 30 minutes','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[1],'item_ids',jsonb_build_array(product)))));
 -- The new shift must include lunch when comparing its end to an existing start.
 perform public.production_schedule_action('save',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at+interval '8 hours 15 minutes','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[2],'item_ids',jsonb_build_array(product)))));
 failed:=false;
 begin
 perform public.production_schedule_action('save',jsonb_build_object('id',gen_random_uuid(),'started_at',start_at,'shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[2],'item_ids',jsonb_build_array(product)))));
 exception when others then if sqlerrm<>'ps_schedule_overlap' then raise;end if;failed:=true;end;
 if not failed then raise exception 'New shift lunch ignored';end if;
 -- Ten-hour plan and the atomic plan RPC use the same 30-minute extension.
 start_at:=start_at+interval '1 day';
 perform public.production_shift_plan(jsonb_build_object('id',gen_random_uuid(),'started_at',start_at,'shift_hours',10,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[2],'item_ids',jsonb_build_array(product)))));
 failed:=false;
 begin
 perform public.production_shift_plan(jsonb_build_object('id',gen_random_uuid(),'started_at',start_at+interval '10 hours 15 minutes','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[2],'item_ids',jsonb_build_array(product)))));
 exception when others then if sqlerrm<>'ps_schedule_overlap' then raise;end if;failed:=true;end;
 if not failed then raise exception 'Ten-hour lunch ignored';end if;
 perform public.production_shift_plan(jsonb_build_object('id',gen_random_uuid(),'started_at',start_at+interval '10 hours 30 minutes','shift_hours',8,'stations',jsonb_build_array(jsonb_build_object('station_code',station_codes[2],'item_ids',jsonb_build_array(product)))));
end $test$;
select 'PASS: 8h ends at 14:30, 10h ends at 16:30; lunch overlap blocked in both directions; exact boundaries allowed' as validation;
rollback;