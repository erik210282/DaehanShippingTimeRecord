-- Run in a transaction and always roll back: no test stock or memberships remain.
insert into public.global_department_memberships(user_id,department,role,active)
values('e37d7e6b-4c88-429b-83a0-8e30540f998c','receiving','operador',true)
on conflict(user_id,department) do update set role='operador',active=true;
update public.global_department_memberships set role='operador' where user_id='e37d7e6b-4c88-429b-83a0-8e30540f998c' and department='shipping';
set local role authenticated;
do $$
declare v_supplier uuid; v_stage uuid; v_storage uuid; v_other uuid; v_item uuid;
 v_receipt uuid:=gen_random_uuid(); v_line uuid; v_task uuid; v_hold uuid; v_total numeric; v_id uuid;
 v_admin text:='270a4a29-8fe0-4eee-8267-9e797be33216';
 v_receiver text:='e37d7e6b-4c88-429b-83a0-8e30540f998c';
 v_token text:=gen_random_uuid()::text;
begin
 perform set_config('request.jwt.claim.sub',v_admin,true);
 v_supplier:=public.receiving_catalog('supplier',jsonb_build_object('code','TEST-'||v_token,'name','Receiving test','street','Main','exterior_number','12','interior_number','3','neighborhood','Center','city','Monterrey','state','Nuevo Leon','postal_code','64000','country','Mexico','phone','555123'));
 v_stage:=public.receiving_catalog('location',jsonb_build_object('code','STAGE-'||v_token,'name','Staging','kind','STORAGE'));
 v_storage:=public.receiving_catalog('location',jsonb_build_object('code','STORE-'||v_token,'name','Storage','kind','STORAGE'));
 v_other:=public.receiving_catalog('location',jsonb_build_object('code','OTHER-'||v_token,'name','Other','kind','STORAGE'));
 v_item:=public.receiving_catalog('item',jsonb_build_object('part_number','ITEM-'||v_token,'description','Test raw','category','RAW','uom','EA','locations',jsonb_build_array(v_storage)));
 perform set_config('request.jwt.claim.sub',v_receiver,true);
 begin
 perform public.receiving_catalog('supplier',jsonb_build_object('code','ILLEGAL-'||v_token,'name','Illegal'));
 raise exception 'TEST: operator edited catalog';
 exception when others then if sqlerrm<>'receiving_forbidden' then raise; end if; end;
 perform public.receiving_start(v_receipt,jsonb_build_object('supplier_id',v_supplier,'manifest','TEST','po_number','PO-123','dock','2','trailer','TR01','lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',10,'lot','TEST'))));
 if not exists(select 1 from public.receiving_receipts r join public.receiving_locations l on l.id=r.staging_id where r.id=v_receipt and l.is_system_stage) then raise exception 'TEST: automatic staging'; end if;
 -- Repeat start is idempotent even after the request times out.
 perform public.receiving_start(v_receipt,'{}'::jsonb);
 if (select count(*) from public.receiving_tasks where receipt_id=v_receipt)<>1 then raise exception 'TEST: duplicate start'; end if;
 select id into v_line from public.receiving_lines where receipt_id=v_receipt;
 perform public.receiving_task(v_receipt,'pause'); perform public.receiving_task(v_receipt,'pause');
 if (select status from public.receiving_tasks where id=v_receipt)<>'paused' then raise exception 'TEST: pause'; end if;
 perform public.receiving_task(v_receipt,'resume');
 begin
 perform public.receiving_task(v_receipt,'finish',jsonb_build_array(jsonb_build_object('id',v_line,'received',12,'damaged',2,'note','')));
 raise exception 'TEST: damage without note';
 exception when others then if sqlerrm<>'receiving_quantity' then raise; end if; end;
 perform public.receiving_task(v_receipt,'finish',jsonb_build_array(jsonb_build_object('id',v_line,'received',12,'damaged',2,'note','Two damaged units; reported, no automatic quarantine')));
 perform public.receiving_task(v_receipt,'finish','[]'::jsonb);
 select sum(quantity_delta) into v_total from public.inventory_movements where item_id=v_item and area='RAW';
 if v_total<>12 then raise exception 'TEST: receipt stock %',v_total; end if;
 if (select quality_status from public.receiving_line_status where id=v_line)<>'available' then raise exception 'TEST: default quarantine'; end if;
 select staging_id into v_stage from public.receiving_receipts where id=v_receipt;
 begin
 perform public.receiving_putaway(gen_random_uuid(),v_line,v_stage,1); raise exception 'TEST: putaway to staging';
 exception when others then if sqlerrm<>'receiving_location' then raise; end if; end;
 begin
 perform public.receiving_putaway(gen_random_uuid(),v_line,v_storage,13);
 raise exception 'TEST: excess putaway accepted';
 exception when others then if sqlerrm<>'receiving_quantity' then raise; end if; end;
 begin
 perform public.receiving_putaway(gen_random_uuid(),v_line,v_other,1);
 raise exception 'TEST: invalid location accepted';
 exception when others then if sqlerrm<>'receiving_location' then raise; end if; end;
 v_task:=gen_random_uuid();
 perform public.receiving_putaway(v_task,v_line,v_storage,4);
 perform public.receiving_putaway(v_task,v_line,v_storage,4);
 if (select available_to_store from public.receiving_line_status where id=v_line)<>8 then raise exception 'TEST: reservation'; end if;
 begin
 perform public.receiving_hold(v_line,'Invalid operator hold'); raise exception 'TEST: operator hold accepted';
 exception when others then if sqlerrm<>'receiving_forbidden' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',v_admin,true);
 v_hold:=public.receiving_hold(v_line,'Explicit supervisor quarantine');
 if public.receiving_hold(v_line,'Retry')<>v_hold then raise exception 'TEST: duplicate quarantine'; end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='RAW')<>0
 or (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='HOLD')<>12 then raise exception 'TEST: quarantine ledger'; end if;
 perform set_config('request.jwt.claim.sub',v_receiver,true);
 perform public.receiving_task(v_task,'pause'); perform public.receiving_task(v_task,'finish');
 if (select stored from public.receiving_line_status where id=v_line)<>4 then raise exception 'TEST: held putaway'; end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='HOLD')<>12 then raise exception 'TEST: putaway doubled inventory'; end if;
 v_id:=gen_random_uuid(); perform public.receiving_putaway(v_id,v_line,v_storage,3); perform public.receiving_task(v_id,'pause'); perform public.receiving_task(v_id,'finish');
 if (select available_to_store from public.receiving_line_status where id=v_line)<>5 then raise exception 'TEST: paused task reservation'; end if;
 v_id:=gen_random_uuid(); perform public.receiving_putaway(v_id,v_line,v_storage,5); perform public.receiving_task(v_id,'finish');
 if (select stored from public.receiving_line_status where id=v_line)<>12 then raise exception 'TEST: complete putaway'; end if;
 perform set_config('request.jwt.claim.sub',v_admin,true);
 perform public.inventory_quality_resolve(v_hold,true,'Quality release');
 if (select quality_status from public.receiving_line_status where id=v_line)<>'released'
 or (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='RAW')<>12
 or (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='HOLD')<>0 then raise exception 'TEST: release'; end if;
 select staging_id into v_stage from public.receiving_receipts where id=v_receipt;
 begin
 perform public.receiving_catalog('location',jsonb_build_object('id',v_stage,'code','CHANGED','name','Changed','material_type','RAW','active',false)); raise exception 'TEST: staging editable';
 exception when others then if sqlerrm<>'receiving_location' then raise; end if; end;
 -- New types, finished products, complete supplier data and PO persist.
 if (select phone from public.receiving_suppliers where id=v_supplier)<>'555123' or (select city from public.receiving_suppliers where id=v_supplier)<>'Monterrey' then raise exception 'TEST: supplier fields'; end if;
 if (select po_number from public.receiving_receipts where id=v_receipt)<>'PO-123' then raise exception 'TEST: PO number'; end if;
 perform public.receiving_catalog('material',jsonb_build_object('code','TEST_TYPE','name','Test resin','category','RAW'));
 v_id:=public.receiving_catalog('item',jsonb_build_object('part_number','CUSTOM-'||v_token,'material_type','TEST_TYPE','uom','KG','locations',jsonb_build_array(v_other)));
 if (select material_type from public.receiving_item_types where item_id=v_id)<>'TEST_TYPE' then raise exception 'TEST: custom type'; end if;
 v_id:=public.receiving_catalog('item',jsonb_build_object('part_number','FG-'||v_token,'category','FG','uom','EA'));
 perform set_config('request.jwt.claim.sub',v_receiver,true);
 v_receipt:=gen_random_uuid();
 begin
 perform public.receiving_start(v_receipt,jsonb_build_object('supplier_id',v_supplier,'manifest','FG-INVOICE','dock','3','trailer','TR02','lines',jsonb_build_array(jsonb_build_object('item_id',v_id,'expected',5))));
 raise exception 'TEST: FG accepted for new receipt'; exception when others then if sqlerrm<>'receiving_invalid' then raise; end if; end;
 if exists(select 1 from public.receiving_receipts where id=v_receipt) then raise exception 'TEST: FG rejection left partial receipt'; end if;
 if (select count(*) from public.receiving_material_types)<4 then raise exception 'TEST: operator material catalogs'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if (select count(*) from public.receiving_receipts)<>0 then raise exception 'TEST: unauthorized read'; end if;
 begin
 perform public.receiving_start(gen_random_uuid(),'{}'::jsonb);raise exception 'TEST: unauthorized write';
 exception when others then if sqlerrm<>'receiving_forbidden' then raise; end if; end;
 if has_function_privilege('anon','public.receiving_start(uuid,jsonb)','EXECUTE')
 or has_function_privilege('anon','rls_internal.receiving_start(uuid,jsonb)','EXECUTE') then raise exception 'TEST: anonymous RPC'; end if;
end $$;
reset role;
select 'PASS: Receiving receipt, surplus, damage, pauses, idempotency, quarantine, partial putaway, reservation, cancellation, release and permissions' as result;
