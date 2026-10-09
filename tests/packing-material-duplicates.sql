begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.global_system_admins limit 1),true);
do $test$
declare fg public.inventory_items%rowtype; material uuid; a jsonb; b jsonb; payload jsonb; saved uuid; before_count integer;
begin
 select * into fg from public.inventory_items where active and category='FG' order by part_number limit 1;
 select id into material from public.inventory_items where active and category='PACKAGING' order by part_number limit 1;
 if fg.id is null or material is null then raise exception 'Missing test catalog';end if;
 a:=jsonb_build_object('ingredient_id',material,'quantity',1,'basis','box','waste_rate',0);
 b:=jsonb_build_object('ingredient_id',material,'quantity',1,'basis','pallet','waste_rate',0);
 payload:=jsonb_build_object('product_part_number',fg.part_number,'active',false,'lines',jsonb_build_array(jsonb_build_object('ingredient_id',fg.id,'quantity_per_unit',1,'waste_rate',0)),
 'packaging',jsonb_build_array(jsonb_build_object('packaging_type',gen_random_uuid(),'box_name','Expendable','pieces_per_box',6,'boxes_per_pallet',8,'lines',jsonb_build_array(a,a))));
 begin
  perform public.inventory_catalog_recipe('save',payload);
  raise exception 'Expected same-basis duplicate rejection';
 exception when raise_exception then
  if sqlerrm<>'pr_pack_material_duplicate' then raise;end if;
 end;
 payload:=jsonb_set(payload,'{packaging,0,lines}',jsonb_build_array(a,b));
 begin
  perform public.inventory_catalog_recipe('save',payload);
  raise exception 'Expected different-basis duplicate rejection';
 exception when raise_exception then
  if sqlerrm<>'pr_pack_material_duplicate' then raise;end if;
 end;
 payload:=jsonb_set(payload,'{packaging}',jsonb_build_array(
 jsonb_build_object('packaging_type',gen_random_uuid(),'box_name','Expendable','pieces_per_box',6,'lines',jsonb_build_array(a)),
 jsonb_build_object('packaging_type',gen_random_uuid(),'box_name','Expendable','pieces_per_box',1,'lines',jsonb_build_array(a))));
 saved:=public.inventory_catalog_recipe('save',payload);
 select count(*) into before_count from public.inventory_bom_packaging_lines where bom_id=saved;
 if before_count<>2 then raise exception 'Same material in separate variants should succeed';end if;
 payload:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(saved)),'{packaging,0,lines}',jsonb_build_array(a,a));
 begin
  perform public.inventory_catalog_recipe('save',payload);
  raise exception 'Expected edit rejection';
 exception when raise_exception then
  if sqlerrm<>'pr_pack_material_duplicate' then raise;end if;
 end;
 if (select count(*) from public.inventory_bom_packaging_lines where bom_id=saved)<>before_count then raise exception 'Failed edit changed saved packing';end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform public.inventory_catalog_recipe('save',payload);
  raise exception 'Expected unauthorized rejection';
 exception when raise_exception then
  if sqlerrm<>'receiving_forbidden' then raise;end if;
 end;
end $test$;
select 'PASS: same/different basis duplicates rejected, separate variants allowed, failed edit preserved, unauthorized blocked' result;
rollback;