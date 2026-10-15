-- Run after shippingPacking.sql. Fixtures and catalog edits ALWAYS roll back.
begin;
do $$
declare p uuid; lid uuid; options jsonb; first_option jsonb; second_option jsonb; payload jsonb;
 context jsonb; line jsonb; changed jsonb; result text; uid uuid; total numeric; activity record; report record;
begin
 select user_id into uid from public.global_system_admins limit 1;
 if uid is null then raise exception 'Test requires an existing active system administrator'; end if;
 -- Anonymous access must fail even though the runner is postgres.
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.shipping_packing_context('PACKING-ROLLBACK-TEST');raise exception 'Anonymous read allowed';
 exception when others then if sqlerrm<>'ra_denied' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 select id into p from public.productos where part_number='2075644-00-D';
 options:=rls_internal.shipping_packing_options(p,false);
 if jsonb_array_length(options)<>2 or exists(select 1 from jsonb_array_elements(options) o,
 jsonb_array_elements(o->'materials') m where m->>'packing_type'<>'expendable') then raise exception 'Wrong variants for 2075644'; end if;
 select o into first_option from jsonb_array_elements(options) o where (o->>'pieces_per_box')::int=1;
 select o into second_option from jsonb_array_elements(options) o where (o->>'pieces_per_box')::int=7;
 insert into public.shipping_lines(idx,idx_line,producto,cantidad_cajas,primera_etiqueta)
 values('PACKING-ROLLBACK-TEST','PACKING-ROLLBACK-TEST-1',p,3,'0001') returning id into lid;
 payload:=jsonb_build_array(jsonb_build_object('line_id',lid,'saved_at',null,'allocations',jsonb_build_array(
 jsonb_build_object('boxes',2,'option_id',first_option->>'option_id','material_id',first_option->'materials'->0->>'id'),
 jsonb_build_object('boxes',1,'option_id',second_option->>'option_id','material_id',second_option->'materials'->0->>'id'))));
 -- A missing variant, a foreign material and a wrong box total must fail atomically.
 changed:=jsonb_set(payload,'{0,allocations,0,option_id}','"returnable"');
 begin perform public.shipping_save_packing('PACKING-ROLLBACK-TEST',changed);raise exception 'Unavailable variant accepted';
 exception when others then if sqlerrm<>'sp_unavailable' then raise; end if; end;
 changed:=jsonb_set(payload,'{0,allocations,0,material_id}','"foreign-material"');
 begin perform public.shipping_save_packing('PACKING-ROLLBACK-TEST',changed);raise exception 'Foreign material accepted';
 exception when others then if sqlerrm<>'sp_material' then raise; end if; end;
 changed:=jsonb_set(payload,'{0,allocations,0,boxes}','3');
 begin perform public.shipping_save_packing('PACKING-ROLLBACK-TEST',changed);raise exception 'Wrong total accepted';
 exception when others then if sqlerrm<>'sp_boxes' then raise; end if; end;
 context:=public.shipping_save_packing('PACKING-ROLLBACK-TEST',payload);line:=context->'lines'->0;
 if rls_internal.shipping_packing_pieces(line->'allocations')<>9 then raise exception 'Mixed packages must total 9 pieces'; end if;
 begin perform public.shipping_save_packing('PACKING-ROLLBACK-TEST',payload);raise exception 'Stale update accepted';
 exception when others then if sqlerrm<>'sp_stale' then raise; end if; end;
 -- Catalog changes must not recalculate a previously saved snapshot.
 update public.inventory_items set packing_measures='999 x 999 x 999 in' where id=coalesce(first_option->'materials'->0->'components'->0->>'id',first_option->'materials'->0->>'id')::uuid;
 payload:=jsonb_set(payload,'{0,saved_at}',line->'saved_at');
 context:=public.shipping_save_packing('PACKING-ROLLBACK-TEST',payload);
 if context->'lines'->0->'allocations'<>line->'allocations' then raise exception 'Snapshot changed with catalog'; end if;
 for activity in select id from public.actividades where lower(nombre) in ('stage','label','scan','load')
 order by case lower(nombre) when 'stage' then 1 when 'label' then 2 when 'scan' then 3 else 4 end loop
  insert into public.actividades_realizadas(idx,actividad,estado,productos) values('PACKING-ROLLBACK-TEST',activity.id::text,'finalizada','[]'::jsonb);
 end loop;
 result:=public.shipping_confirm_packing('PACKING-ROLLBACK-TEST',current_date-1,
 jsonb_build_array(jsonb_build_object('line_id',lid,'saved_at',line->'saved_at')));
 select pieces into total from public.inventory_dispatch_lines where shipping_line_id=lid;
 if total<>9 then raise exception 'Wrong dispatched pieces: %',total; end if;
 select quantity_delta into total from public.inventory_movements where reference_key='dispatch:'||lid;
 if total<>-9 then raise exception 'Wrong inventory deduction: %',total; end if;
 begin perform public.shipping_save_packing('PACKING-ROLLBACK-TEST',payload);raise exception 'Confirmed shipment editable';
 exception when others then if sqlerrm<>'sp_confirmed' then raise; end if; end;
 -- The approved 63-inch source is the material, not the old 62.50-inch FG field.
 select id into p from public.productos where part_number='1733519-20-D';
 options:=rls_internal.shipping_packing_options(p,false);
 if not exists(select 1 from jsonb_array_elements(options) o,jsonb_array_elements(o->'materials') m
 where m->>'part_number'='3CM1993' and m->>'dimensions' like '63%') then raise exception 'Missing 63-inch source'; end if;
 -- Inactive products retain their fixed legacy choices.
 update public.productos set activo=false where id=p;
 options:=rls_internal.shipping_packing_options(p,false);
 if exists(select 1 from jsonb_array_elements(options) o where (o->>'legacy')::boolean is not true) then raise exception 'Inactive values changed'; end if;
 -- Grouped production references retain the report and its saved capacity.
 select r.*,i.producto_id into report from public.production_station_reports r join public.inventory_items i on i.id=r.item_id
 join public.productos p on p.id=i.producto_id where r.status='posted' and r.packed_quantity>0 and r.pieces_per_box>0 and p.activo and i.active limit 1;
 if report.id is not null then
  options:=rls_internal.shipping_packing_options(report.producto_id,false);
  select o into first_option from jsonb_array_elements(options) o where o->'production_reports' @> jsonb_build_array(jsonb_build_object('id',report.id::text));
  if first_option is null then raise exception 'Production report option missing'; end if;
  insert into public.shipping_lines(idx,idx_line,producto,cantidad_cajas,primera_etiqueta)
  values('PACKING-ROLLBACK-PRODUCTION','PACKING-ROLLBACK-PRODUCTION-1',report.producto_id,1,'0001') returning id into lid;
  payload:=jsonb_build_array(jsonb_build_object('line_id',lid,'allocations',jsonb_build_array(jsonb_build_object(
   'boxes',1,'option_id',first_option->>'option_id','material_id',first_option->'materials'->0->>'id',
   'expected_capacity',report.pieces_per_box,'expected_dimensions',first_option->'materials'->0->>'dimensions'))));
  changed:=jsonb_set(payload,'{0,allocations,0,expected_capacity}','999999');
  begin perform public.shipping_save_packing('PACKING-ROLLBACK-PRODUCTION',changed);raise exception 'Changed catalog capacity accepted';
  exception when others then if sqlerrm<>'sp_stale' then raise; end if; end;
  context:=public.shipping_save_packing('PACKING-ROLLBACK-PRODUCTION',payload);
  if not coalesce(context->'lines'->0->'allocations'->0->'production_reports' @> jsonb_build_array(jsonb_build_object('id',report.id::text)),false) then raise exception 'Production link lost'; end if;
 end if;
end $$;
select 'PASS: variants, materials, splits, totals, stale edits, snapshots, confirmation, inventory, 63 inches, inactive fallback and anonymous denial' as shipping_packing_test;
rollback;
