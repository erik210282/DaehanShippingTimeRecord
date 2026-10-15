begin;
set local jit=off;
do $$
declare p uuid; opts jsonb; a jsonb; b jsonb; payload jsonb; response jsonb; row_data jsonb; lid uuid; uid uuid; activity record; total numeric;
begin
 select user_id into uid from public.global_system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 select id into p from public.productos where part_number='1935903-50-E';
 opts:=rls_internal.shipping_packing_options(p,false);
 if jsonb_array_length(opts)<>1 then raise exception 'Repeated reports must produce one configuration'; end if;
 a:=opts->0;
 if jsonb_array_length(a->'production_reports')<3 then raise exception 'Production references lost'; end if;
 if jsonb_array_length(a->'materials')<>1 or jsonb_array_length(a->'materials'->0->'components')<>2 then raise exception 'Box and pallet separated'; end if;
 if (a->'materials'->0->>'box_weight')::numeric<>81.1 then raise exception 'Incomplete packaging weight'; end if;
 if a->'materials'->0->>'dimension_source'<>'existing_package' then raise exception 'Unverified component dimensions used'; end if;
 if a->'materials'->0->>'dimensions' is distinct from (select tipo_empaque_expendable from public.productos where id=p) then raise exception 'Existing assembly dimensions changed'; end if;
 select id into p from public.productos where part_number='2075644-00-D';
 opts:=rls_internal.shipping_packing_options(p,false);
 if jsonb_array_length(opts)<>2 then raise exception 'Different capacities collapsed'; end if;
 select o into a from jsonb_array_elements(opts) o where (o->>'pieces_per_box')::int=1;
 select o into b from jsonb_array_elements(opts) o where (o->>'pieces_per_box')::int=7;
 if (a->'materials'->0->>'box_weight')::numeric<>90 or (b->'materials'->0->>'box_weight')::numeric<>322 then raise exception 'Wrong complete weights'; end if;
 insert into public.shipping_lines(idx,idx_line,producto,cantidad_cajas,primera_etiqueta)
 values('ASSEMBLY-ROLLBACK-TEST','ASSEMBLY-ROLLBACK-TEST-1',p,3,'0001') returning id into lid;
 payload:=jsonb_build_array(jsonb_build_object('line_id',lid,'allocations',jsonb_build_array(
 jsonb_build_object('boxes',2,'option_id',a->>'option_id','material_id',a->'materials'->0->>'id'),
 jsonb_build_object('boxes',1,'option_id',b->>'option_id','material_id',b->'materials'->0->>'id'))));
 response:=public.shipping_save_packing('ASSEMBLY-ROLLBACK-TEST',payload);row_data:=response->'lines'->0;
 if (row_data->'allocations'->0->>'assembly_version')::int<>2 or jsonb_array_length(row_data->'allocations'->0->'components')<>2 then raise exception 'Incomplete snapshot'; end if;
 if rls_internal.shipping_packing_pieces(row_data->'allocations')<>9 then raise exception 'Wrong pieces'; end if;
 for activity in select id from public.actividades where lower(nombre) in ('stage','label','scan','load')
 order by case lower(nombre) when 'stage' then 1 when 'label' then 2 when 'scan' then 3 else 4 end loop
  insert into public.actividades_realizadas(idx,actividad,estado,productos) values('ASSEMBLY-ROLLBACK-TEST',activity.id::text,'finalizada','[]'::jsonb);
 end loop;
 perform public.shipping_confirm_packing('ASSEMBLY-ROLLBACK-TEST',current_date-1,jsonb_build_array(jsonb_build_object('line_id',lid,'saved_at',row_data->'saved_at')));
 select pieces into total from public.inventory_dispatch_lines where shipping_line_id=lid;
 if total<>9 then raise exception 'Wrong confirmed pieces'; end if;
 select quantity_delta into total from public.inventory_movements where reference_key='dispatch:'||lid;
 if total<>-9 then raise exception 'Wrong inventory deduction'; end if;
 begin perform public.shipping_save_packing('ASSEMBLY-ROLLBACK-TEST',payload);raise exception 'Confirmed shipment changed';
 exception when others then if sqlerrm<>'sp_confirmed' then raise; end if;end;
 -- Correct returnable dimensions still come from the complete crate material.
 select id into p from public.productos where part_number='1733519-20-D';
 opts:=rls_internal.shipping_packing_options(p,false);
 if not exists(select 1 from jsonb_array_elements(opts) o where o->'materials'->0->>'packing_type'='returnable' and o->'materials'->0->>'dimensions' like '63%') then raise exception '63-inch crate missing'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.shipping_packing_context('ASSEMBLY-ROLLBACK-TEST');raise exception 'Anonymous access allowed';
 exception when others then if sqlerrm<>'ra_denied' then raise; end if;end;
end $$;
select 'PASS: reports deduplicated; complete materials, weight and dimensions; distinct 1/7 capacities; exact inventory; immutable history; 63-inch crate; permissions' as assembly_test;
rollback;
