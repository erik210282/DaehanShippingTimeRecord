-- Execute after the migration inside BEGIN / ROLLBACK. Fixture stock never persists.
insert into public.global_department_memberships(user_id,department,role,active)
values('e37d7e6b-4c88-429b-83a0-8e30540f998c','receiving','operador',true)
on conflict(user_id,department) do update set role='operador',active=true;
update public.global_department_memberships set role='lider' where user_id='e37d7e6b-4c88-429b-83a0-8e30540f998c' and department='shipping';
set local role authenticated;
do $$
declare v_admin text:='270a4a29-8fe0-4eee-8267-9e797be33216'; v_operator text:='e37d7e6b-4c88-429b-83a0-8e30540f998c';
 v_token text:=gen_random_uuid()::text; v_item uuid; v_supplier uuid; v_location uuid; v_product uuid;
 v_a uuid:=gen_random_uuid();v_b uuid:=gen_random_uuid();v_line uuid;v_put uuid:=gen_random_uuid();v_hold uuid;
begin
 perform set_config('request.jwt.claim.sub',v_operator,true);
 -- A Shipping leader creates Receiving materials through the same checked catalog.
 v_supplier:=public.shared_catalog('supplier',jsonb_build_object('code','QA-'||v_token,'name','QA Supplier','city','Monterrey','phone','123456'));
 v_location:=public.shared_catalog('location',jsonb_build_object('code','QA-'||v_token,'name','QA Location','material_type','FG'));
 v_item:=public.shared_catalog('item',jsonb_build_object('part_number','QA-FG-'||v_token,'description','QA FG','material_type','FG','uom','EA','minimum_quantity',25,'locations',jsonb_build_array(v_location),'shipping',jsonb_build_object('nombre','QA Finished','peso_por_pieza',1.5,'cantidad_por_caja_retornable',20)));
 select producto_id into v_product from public.inventory_items where id=v_item;
 if v_product is null or (select minimum_quantity from public.inventory_items where id=v_item)<>25 or (select cantidad_por_caja_retornable from public.productos where id=v_product)<>20 then raise exception 'TEST: shared Shipping FG identity and minimum'; end if;
 perform public.shared_catalog('item',jsonb_build_object('id',v_item,'part_number','QA-FG-'||v_token,'description','QA Updated','material_type','FG','uom','EA','minimum_quantity',30,'locations',jsonb_build_array(v_location)));
 if (select producto_id from public.inventory_items where id=v_item)<>v_product or (select minimum_quantity from public.inventory_items where id=v_item)<>30 or (select cantidad_por_caja_retornable from public.productos where id=v_product)<>20 then raise exception 'TEST: edit preserved identity and Shipping packaging'; end if;
 begin
 perform public.shared_catalog('item',jsonb_build_object('part_number',lower('QA-FG-'||v_token),'material_type','RAW','uom','KG','minimum_quantity',1));
 raise exception 'TEST: duplicate product allowed'; exception when others then if sqlerrm<>'catalog_duplicate_part' then raise; end if; end;
 begin
 perform public.shared_catalog('item',jsonb_build_object('part_number','QA-INVALID-'||v_token,'material_type','RAW','uom','EA','minimum_quantity',-1));
 raise exception 'TEST: invalid minimum allowed'; exception when others then if sqlerrm<>'receiving_quantity' then raise; end if; end;
 -- Keep FG in the shared Shipping catalog but reject it for new trailer receipts.
 begin
 perform public.receiving_start(gen_random_uuid(),jsonb_build_object('supplier_id',v_supplier,'manifest','FG BLOCKED','dock','1','trailer','QA','lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',1))));
 raise exception 'TEST: finished product accepted for new receipt'; exception when others then if sqlerrm<>'receiving_invalid' then raise; end if; end;
 if (select count(*) from public.receiving_receipts where manifest='FG BLOCKED')<>0 then raise exception 'TEST: rejected FG left receipt'; end if;
 v_item:=public.shared_catalog('item',jsonb_build_object('part_number','QA-RAW-'||v_token,'description','QA raw','material_type','RAW','uom','EA','minimum_quantity',2,'locations',jsonb_build_array(v_location)));
 perform set_config('request.jwt.claim.sub',v_admin,true);
 perform public.receiving_start(v_a,jsonb_build_object('supplier_id',v_supplier,'manifest','QA Participants','dock','1','trailer','QA','additional_operator_ids',jsonb_build_array(v_operator),'lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',8))));
 if not exists(select 1 from public.receiving_tasks where id=v_a and v_operator::uuid=any(additional_operator_ids)) then raise exception 'TEST: additional operators not recorded'; end if;
 perform set_config('request.jwt.claim.sub',v_operator,true);
 begin
 perform public.receiving_start(v_b,jsonb_build_object('supplier_id',v_supplier,'manifest','QA Second','dock','1','trailer','QA','lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',1))));
 raise exception 'TEST: overlapping participant allowed'; exception when others then if sqlerrm<>'receiving_operator_busy' then raise; end if; end;
 perform public.receiving_task(v_a,'pause');
 perform public.receiving_start(v_b,jsonb_build_object('supplier_id',v_supplier,'manifest','QA Second','dock','1','trailer','QA','lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',1))));
 begin
 perform public.receiving_task(v_a,'resume');raise exception 'TEST: overlapping resume'; exception when others then if sqlerrm<>'receiving_operator_busy' then raise; end if; end;
 perform public.receiving_task(v_b,'pause');
 perform public.receiving_task(v_a,'resume');
 select id into v_line from public.receiving_lines where receipt_id=v_a;
 perform public.receiving_task(v_a,'finish',jsonb_build_array(jsonb_build_object('id',v_line,'received',8,'damaged',0,'note','')));
 perform set_config('request.jwt.claim.sub',v_admin,true);
 v_hold:=public.receiving_hold(v_line,'QA held stock');
 perform public.receiving_putaway_group(v_put,v_line,v_location,8,jsonb_build_array(v_operator));
 perform set_config('request.jwt.claim.sub',v_operator,true);
 perform public.receiving_task(v_put,'finish');
 if not exists(select 1 from public.receiving_line_status where id=v_line and stored=8 and quality_status='held') then raise exception 'TEST: quarantine disappeared after complete putaway'; end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=v_item and area='HOLD')<>8 then raise exception 'TEST: held stock doubled or disappeared'; end if;
 begin
 perform public.inventory_quality_resolve(v_hold,true,'Not authorized');raise exception 'TEST: operator released quarantine'; exception when others then if sqlerrm<>'Retención no disponible para revisión' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',v_admin,true);
 perform public.inventory_quality_resolve(v_hold,true,'QA release');
 if (select quality_status from public.receiving_line_status where id=v_line)<>'released' then raise exception 'TEST: explicit quality release'; end if;
 begin
 perform public.receiving_start(gen_random_uuid(),jsonb_build_object('supplier_id',v_supplier,'manifest','QA Invalid','dock','1','trailer','QA','additional_operator_ids',jsonb_build_array(gen_random_uuid()),'lines',jsonb_build_array(jsonb_build_object('item_id',v_item,'expected',1))));raise exception 'TEST: unassigned additional operator allowed';
 exception when others then if sqlerrm<>'receiving_invalid_operator' then raise; end if; end;
 if has_column_privilege('authenticated','public.inventory_items','unit_cost','SELECT') then raise exception 'TEST: catalog exposed cost'; end if;
 if has_function_privilege('anon','public.shared_catalog(text,jsonb)','EXECUTE') then raise exception 'TEST: anonymous catalog mutation'; end if;
end $$;
reset role;
update public.global_department_memberships set role='operador' where user_id='e37d7e6b-4c88-429b-83a0-8e30540f998c' and department='shipping';
select 'PASS: shared FG identity, Shipping fields, minimum, duplicates, department participants, paused parallel tasks, stock preservation, explicit quarantine release and protected cost' as result;
