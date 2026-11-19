create or replace function rls_internal.revision_refs(p_source uuid)
returns table(key text,kind text,label text,snapshot jsonb) language sql stable set search_path='' as $$
 select 'bom:'||b.id,'bom',b.product_part_number||' · v'||b.version,
 to_jsonb(b)||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_bom_lines l where l.bom_id=b.id),'[]'),
 'packing',coalesce((select jsonb_agg(to_jsonb(p) order by p.packaging_type) from public.inventory_bom_packaging p where p.bom_id=b.id),'[]'),
 'packing_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_bom_packaging_lines l where l.bom_id=b.id),'[]'))
 from public.inventory_boms b where b.active and not b.archived and (b.finished_item_id=p_source or b.product_part_number=(select part_number from public.inventory_items where id=p_source)
 or exists(select 1 from public.inventory_bom_lines l where l.bom_id=b.id and l.ingredient_id=p_source)
 or exists(select 1 from public.inventory_bom_packaging_lines l where l.bom_id=b.id and l.ingredient_id=p_source))
 union all select 'station:'||s.code,'station',s.code||' · '||s.name,to_jsonb(s) from public.inventory_workstations s
 where s.active and (p_source=any(s.raw_material_ids) or rls_internal.revision_json(s.materials,p_source::text,'__replacement__',(select part_number from public.inventory_items where id=p_source),'__replacement__')<>s.materials)
 union all select 'machine:'||m.root_station_code||':'||m.dependency_station_code,'machine',m.root_station_code||' → '||m.dependency_station_code,to_jsonb(m)
 from public.inventory_machine_bom_links m where p_source=any(m.item_ids)
 union all select 'target:'||t.item_id,'target',i.part_number,to_jsonb(t) from public.production_targets t join public.inventory_items i on i.id=t.item_id where t.item_id=p_source and t.deleted_at is null
 union all select 'parameter:'||t.id,'parameter',t.name||' · v'||t.version,to_jsonb(t) from public.production_parameter_templates t where t.active and t.deleted_at is null and (t.item_id=p_source or p_source=any(t.item_ids))
 union all select 'schedule:'||s.id,'schedule',s.started_at::text,to_jsonb(s) from public.production_shift_schedule s where s.status in ('scheduled','failed') and rls_internal.revision_json(s.payload,p_source::text,'__replacement__',(select part_number from public.inventory_items where id=p_source),'__replacement__')<>s.payload;
$$;

create or replace function rls_internal.catalog_revision_preview(p_source uuid,p_target uuid)
returns jsonb language plpgsql set search_path='' security definer as $$
declare src public.inventory_items%rowtype; dst public.inventory_items%rowtype; r record; refs jsonb:='[]'; problems jsonb; runs integer; token text;
begin
 if auth.uid() is null or not public.inventory_access('catalogs',true) then raise exception 'cr_forbidden';end if;
 select * into src from public.inventory_items where id=p_source;
 select * into dst from public.inventory_items where id=p_target;
 if src.id is null or dst.id is null or src.id=dst.id or not dst.active then raise exception 'cr_choose';end if;
 if src.category is distinct from dst.category or lower(btrim(src.uom)) is distinct from lower(btrim(dst.uom)) then raise exception 'cr_incompatible';end if;
 for r in select * from rls_internal.revision_refs(p_source) order by key loop
  problems:='[]';
  if r.snapshot::text like '%'||p_target::text||'%' or (r.kind='bom' and (r.snapshot->>'finished_item_id'=p_source::text or r.snapshot->>'product_part_number'=src.part_number) and exists(select 1 from public.inventory_boms where (finished_item_id=p_target or product_part_number=dst.part_number) and active and not archived)) or (r.kind='target' and exists(select 1 from public.production_targets where item_id=p_target))
  then problems:=problems||'"cr_conflict"'::jsonb;end if;
  select count(*) into runs from public.production_live_runs l where l.deleted_at is null and l.closed_at is null and
   (l.item_id in(p_source,p_target) or r.kind='bom' and l.item_id::text=r.snapshot->>'finished_item_id'
    or r.kind='station' and l.station_code=r.snapshot->>'code');
  if runs>0 then problems:=problems||'"cr_running"'::jsonb;end if;
  refs:=refs||jsonb_build_object('key',r.key,'kind',r.kind,'label',r.label,'snapshot',r.snapshot,'blockers',problems);
 end loop;
 token:=md5(jsonb_build_object('source',to_jsonb(src),'target',to_jsonb(dst),'refs',refs)::text);
 return jsonb_build_object('source',jsonb_build_object('id',src.id,'part_number',src.part_number,'name',src.part_name,'uom',src.uom,'category',src.category),
 'target',jsonb_build_object('id',dst.id,'part_number',dst.part_number,'name',dst.part_name,'uom',dst.uom,'category',dst.category),'token',token,'relations',refs,
 'stock',coalesce((select sum(quantity) from public.inventory_balances where item_id=p_source),0),
 'history',jsonb_build_object('movements',(select count(*) from public.inventory_movements where item_id=p_source),'reports',(select count(*) from public.production_station_reports where item_id=p_source),'loads',(select count(*) from public.production_material_loads where item_id=p_source)));
end $$;

create or replace function rls_internal.catalog_revision_apply(p_source uuid,p_target uuid,p_keys text[],p_token text,p_request uuid,p_note text default '')
returns jsonb language plpgsql set search_path='' security definer as $$
declare preview jsonb; r jsonb; old jsonb; patched jsonb; result jsonb; changes jsonb:='[]'; new_id uuid; new_part text; next_version integer; srcpart text; dstpart text; dstname text; n integer;
begin
 if auth.uid() is null or not public.inventory_access('catalogs',true) then raise exception 'cr_forbidden';end if;
 if p_request is null or coalesce(cardinality(p_keys),0)=0 then raise exception 'cr_select';end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog:revision',0));
 select c.result into result from public.catalog_revision_changes c where c.id=p_request and c.source_id=p_source and c.target_id=p_target and c.created_by=auth.uid();
 if found then return result;end if;
 perform set_config('lock_timeout','5s',true);
 lock table public.inventory_items in share mode;
 lock table public.production_live_runs in share mode;
 lock table public.inventory_boms,public.inventory_bom_lines,public.inventory_bom_packaging,public.inventory_bom_packaging_lines,public.inventory_workstations,public.inventory_machine_bom_links,public.production_targets,public.production_parameter_templates,public.production_shift_schedule in share row exclusive mode;
 preview:=rls_internal.catalog_revision_preview(p_source,p_target);
 if preview->>'token' is distinct from p_token then raise exception 'cr_stale';end if;
 if exists(select 1 from unnest(p_keys) k where not exists(select 1 from jsonb_array_elements(preview->'relations') x where x->>'key'=k)) then raise exception 'cr_stale';end if;
 if exists(select 1 from jsonb_array_elements(preview->'relations') x where x->>'key'=any(p_keys) and jsonb_array_length(x->'blockers')>0) then raise exception 'cr_blocked';end if;
 srcpart:=preview->'source'->>'part_number';dstpart:=preview->'target'->>'part_number';dstname:=preview->'target'->>'name';
 for r in select value from jsonb_array_elements(preview->'relations') where value->>'key'=any(p_keys) loop
  old:=r->'snapshot';patched:=rls_internal.revision_json(old,p_source::text,p_target::text,srcpart,dstpart);
  case r->>'kind'
  when 'bom' then
   if old->>'product_part_number'=srcpart then patched:=patched||jsonb_build_object('finished_item_id',p_target);end if;
   new_part:=patched->>'product_part_number';
   perform pg_advisory_xact_lock(hashtextextended('recipe:'||new_part,0));
   select coalesce(max(version),0)+1 into next_version from public.inventory_boms where product_part_number=new_part;
   update public.inventory_boms set active=false where id=(old->>'id')::uuid;
   insert into public.inventory_boms(finished_item_id,product_part_number,version,active,notes,created_by)
   values((patched->>'finished_item_id')::uuid,new_part,next_version,true,patched->>'notes',auth.uid()) returning id into new_id;
   insert into public.inventory_bom_lines(bom_id,ingredient_id,quantity_per_unit,waste_rate)
   select new_id,(x->>'ingredient_id')::uuid,(x->>'quantity_per_unit')::numeric,(x->>'waste_rate')::numeric from jsonb_array_elements(patched->'lines') x;
   insert into public.inventory_bom_packaging(bom_id,packaging_type,pieces_per_box,box_name,boxes_per_pallet,shipping_dimensions)
   select new_id,x->>'packaging_type',(x->>'pieces_per_box')::integer,x->>'box_name',(x->>'boxes_per_pallet')::integer,x->>'shipping_dimensions' from jsonb_array_elements(patched->'packing') x;
   insert into public.inventory_bom_packaging_lines(bom_id,packaging_type,ingredient_id,quantity,basis,waste_rate)
   select new_id,x->>'packaging_type',(x->>'ingredient_id')::uuid,(x->>'quantity')::numeric,x->>'basis',(x->>'waste_rate')::numeric from jsonb_array_elements(patched->'packing_lines') x;
   patched:=patched||jsonb_build_object('id',new_id,'version',next_version);
  when 'station' then
   select coalesce(jsonb_agg(case when x->>'item_id'=p_target::text then x||jsonb_build_object('client_part_number',dstpart,'client_part_name',dstname) else x end),'[]') into result from jsonb_array_elements(patched->'materials') x;
   update public.inventory_workstations set materials=result,raw_material_ids=array(select distinct jsonb_array_elements_text(patched->'raw_material_ids')::uuid) where code=old->>'code';
  when 'machine' then
   update public.inventory_machine_bom_links set item_ids=array(select distinct jsonb_array_elements_text(patched->'item_ids')::uuid),updated_at=clock_timestamp(),updated_by=auth.uid() where root_station_code=old->>'root_station_code' and dependency_station_code=old->>'dependency_station_code';
  when 'target' then
   if exists(select 1 from public.production_targets where item_id=p_target) then raise exception 'cr_conflict';end if;
   insert into public.production_targets(item_id,pieces_per_hour,interval_hours,warning_percent,critical_percent,target_8h,target_10h,updated_by,updated_at)
   select p_target,pieces_per_hour,interval_hours,warning_percent,critical_percent,target_8h,target_10h,auth.uid(),clock_timestamp() from public.production_targets where item_id=p_source;
   update public.production_targets set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid() where item_id=p_source;
  when 'parameter' then
   update public.production_parameter_templates set active=false,updated_by=auth.uid(),updated_at=clock_timestamp() where id=(old->>'id')::uuid;
   insert into public.production_parameter_templates(id,name,machine_types,station_code,item_id,fields,version,active,created_by,updated_by,item_ids,station_codes)
   select gen_random_uuid(),name,machine_types,station_code,case when item_id=p_source then p_target else item_id end,fields,version+1,true,auth.uid(),auth.uid(),array(select distinct case when x=p_source then p_target else x end from unnest(item_ids) x),station_codes from public.production_parameter_templates where id=(old->>'id')::uuid returning id into new_id;
   patched:=patched||jsonb_build_object('id',new_id,'version',(old->>'version')::integer+1);
  when 'schedule' then
   update public.production_shift_schedule set payload=patched->'payload',updated_at=clock_timestamp() where id=(old->>'id')::uuid;
  else raise exception 'cr_stale';
  end case;
  select snapshot into patched from rls_internal.revision_refs(p_target) where key=case r->>'kind' when 'bom' then 'bom:'||new_id when 'parameter' then 'parameter:'||new_id when 'target' then 'target:'||p_target else r->>'key' end;
  if patched is null then raise exception 'cr_stale';end if;
  changes:=changes||jsonb_build_object('key',r->>'key','kind',r->>'kind','label',r->>'label','before',old,'after',patched);
 end loop;
 update public.catalog_updates set version=version+1 where id=1;
 result:=jsonb_build_object('id',p_request,'source',preview->'source','target',preview->'target','applied_at',clock_timestamp(),'changes',changes,'remaining',rls_internal.catalog_revision_preview(p_source,p_target));
 insert into public.catalog_revision_changes(id,source_id,target_id,created_by,note,result) values(p_request,p_source,p_target,auth.uid(),left(coalesce(p_note,''),2000),result);
 return result;
end $$;


