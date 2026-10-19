begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare station text:='RAW-STATION-'||substr(gen_random_uuid()::text,1,8); raw1 uuid:=gen_random_uuid();raw2 uuid:=gen_random_uuid();fg uuid:=gen_random_uuid();bom uuid:=gen_random_uuid();result jsonb;
begin
 insert into public.inventory_items(id,part_number,category) values(raw1,'STATION-RAW1-'||raw1,'RAW'),(raw2,'STATION-RAW2-'||raw2,'RAW'),(fg,'STATION-FG-'||fg,'FG');
 insert into public.inventory_workstations(code,name,machine_type,materials) values(station,'Manual RAW assignment','test',jsonb_build_array(jsonb_build_object('item_id',fg)));
 insert into public.inventory_boms(id,finished_item_id,version,active) values(bom,fg,1,true);
 insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit) values(bom,raw2,1);
 if exists(select 1 from rls_internal.production_station_raw_ids(station)) then raise exception 'Product BOM must not configure workstation materials';end if;
 update public.inventory_workstations set raw_material_ids=array[raw1,raw2] where code=station;
 if (select count(*) from rls_internal.production_station_raw_ids(station))<>2 then raise exception 'Multiple explicit materials not available';end if;
 update public.inventory_workstations set raw_material_ids=array[raw1] where code=station;
 if exists(select 1 from rls_internal.production_station_raw_ids(station) where item_id=raw2) then raise exception 'BOM restored removed material';end if;
 perform public.production_supply_action('load',jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw1,'quantity',12));
 begin
  perform public.production_supply_action('load',jsonb_build_object('id',gen_random_uuid(),'station_code',station,'item_id',raw2,'quantity',12));
  raise exception 'BOM material loaded without station assignment';
 exception when others then if sqlerrm<>'ps_station_material_invalid' then raise;end if;end;
 begin
  update public.inventory_workstations set raw_material_ids=array[fg] where code=station;
  raise exception 'FG accepted as RAW';
 exception when others then if sqlerrm<>'dt_raw_invalid' then raise;end if;end;
 begin
  update public.inventory_workstations set raw_material_ids=array[raw1,raw1] where code=station;
  raise exception 'Duplicate RAW accepted';
 exception when others then if sqlerrm<>'dt_raw_invalid' then raise;end if;end;
 update public.inventory_workstations set raw_material_ids='{}'::uuid[] where code=station;
 if exists(select 1 from rls_internal.production_station_raw_ids(station)) then raise exception 'Empty manual assignment used fallback';end if;
 result:=public.production_supply_snapshot();
 if exists(select 1 from jsonb_array_elements(result->'station_materials') r where r->>'station_code'=station) then raise exception 'Snapshot leaked inferred RAW';end if;
end $test$;
select 'PASS explicit workstation RAW selection, independent of BOM, multiple/add/remove/empty, invalid categories/duplicates, and loading enforcement' as result;
rollback;
