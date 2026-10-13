begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare fixture_item uuid:=gen_random_uuid();hold uuid;request uuid:=gen_random_uuid();payload jsonb;amount numeric;actor uuid;snapshot jsonb;
begin
 insert into public.inventory_items(id,part_number,category,part_name) values(fixture_item,'REWORK-TEST-'||fixture_item,'FG','Rework test');
 insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,created_by) values(fixture_item,'FG',1000,'OPENING','rw-test:'||fixture_item,auth.uid());
 hold:=public.inventory_quality_hold(fixture_item,'FG',300,'Test quarantine','Test lot');
 select quantity into amount from public.inventory_balances b where b.item_id=fixture_item and b.area='FG';
 if amount<>700 then raise exception 'hold did not reduce available stock';end if;
 payload:=jsonb_build_object('id',request,'hold_id',hold,'good_quantity',200,'scrap_quantity',10,'recorded_at',clock_timestamp()-interval '1 minute','timezone','UTC','note','First partial rework');
 perform public.production_rework_action('report',payload);perform public.production_rework_action('report',payload);
 if (select count(*) from public.production_rework_reports where id=request)<>1 then raise exception 'duplicate report';end if;
 snapshot:=public.production_rework_snapshot();
 if not exists(select 1 from jsonb_array_elements(snapshot->'holds')x where x->>'id'=hold::text and (x->>'pending_quantity')::numeric=210 and (x->>'remaining_quantity')::numeric=300) then raise exception 'pending result prematurely changed quarantine';end if;
 begin
  perform public.production_rework_action('report',payload||jsonb_build_object('id',gen_random_uuid(),'good_quantity',90,'scrap_quantity',1));
  raise exception 'reserved stock reported twice';
 exception when others then if sqlerrm<>'rw_exceeds' then raise;end if;end;
 begin
  perform public.inventory_quality_resolve(hold,true,'Premature release');
  raise exception 'legacy release bypassed pending review';
 exception when others then if sqlerrm<>'rw_pending_review' then raise;end if;end;
 select user_id into actor from public.global_department_memberships where department='production' and active and user_id not in(select user_id from public.global_system_admins) limit 1;
 update public.global_department_memberships set active=false where user_id=actor and department='quality';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.production_rework_action('approve',jsonb_build_object('id',request));
  raise exception 'production approved Quality disposition';
 exception when others then if sqlerrm<>'ra_denied' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 perform public.production_rework_action('approve',jsonb_build_object('id',request));perform public.production_rework_action('approve',jsonb_build_object('id',request));
 select quantity into amount from public.inventory_balances b where b.item_id=fixture_item and b.area='FG';if amount<>900 then raise exception 'partial release or retry corrupted FG';end if;
 select quantity into amount from public.inventory_balances b where b.item_id=fixture_item and b.area='HOLD';if amount<>90 then raise exception 'partial disposition lost retained remainder';end if;
 request:=gen_random_uuid();payload:=payload||jsonb_build_object('id',request,'good_quantity',70,'scrap_quantity',20);
 perform public.production_rework_action('report',payload);perform public.production_rework_action('reject',jsonb_build_object('id',request,'note','Correction required'));
 request:=gen_random_uuid();payload:=payload||jsonb_build_object('id',request);perform public.production_rework_action('report',payload);perform public.production_rework_action('approve',jsonb_build_object('id',request));
 select quantity into amount from public.inventory_balances b where b.item_id=fixture_item and b.area='FG';if amount<>970 then raise exception 'final available stock should be 970';end if;
 select quantity into amount from public.inventory_balances b where b.item_id=fixture_item and b.area='HOLD';if amount<>0 then raise exception 'resolved quarantine must be zero';end if;
 if not exists(select 1 from public.inventory_quality_holds where id=hold and status='resolved' and released_quantity=270 and rejected_quantity=30) then raise exception 'rework totals do not reconcile';end if;
 if exists(select 1 from public.inventory_movements where item_id=fixture_item and (area='RAW' or kind='PRODUCTION')) then raise exception 'rework double-counted production or raw consumption';end if;
end $test$;
rollback;
