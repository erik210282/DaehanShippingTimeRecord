begin;
do $test$
declare member record; expected integer; actual integer; row public.production_material_loads; snap jsonb; q numeric; first_uid uuid;
begin
 select count(*) into expected from public.inventory_bom_packaging;
 for member in select m.user_id,m.role from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo loop
  perform set_config('request.jwt.claim.sub',member.user_id::text,true);
  execute 'set local role authenticated';
  select count(*) into actual from public.inventory_bom_packaging;
  if actual<>expected then raise exception 'packing hidden for %: %/%',member.role,actual,expected;end if;
  if not exists(select 1 from public.catalog_updates where id=1) then raise exception 'refresh hidden for %',member.role;end if;
  execute 'reset role';
 end loop;
 select m.user_id into first_uid from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo and m.role='supervisor' limit 1;
 perform set_config('request.jwt.claim.sub',first_uid::text,true);
 insert into public.production_material_loads(id,station_code,item_id,quantity,alert_minutes,created_by)
 select gen_random_uuid(),w.code,i.id,100,15,first_uid from public.inventory_workstations w join public.inventory_items i on i.id=any(w.raw_material_ids) where w.active and i.active limit 1 returning * into row;
 if row.id is null then raise exception 'load fixture missing';end if;
 execute 'set local role authenticated';
 perform public.production_material_load_action('edit',jsonb_build_object('id',row.id,'version',coalesce(row.updated_at,row.created_at),'quantity',row.quantity+10));
 snap:=public.production_supply_snapshot();
 select (m->>'loaded_quantity')::numeric into q from jsonb_array_elements(snap->'materials')m where m->>'station_code'=row.station_code and m->>'item_id'=row.item_id::text;
 execute 'reset role';
 if q<>(select sum(quantity) from public.production_material_loads where station_code=row.station_code and item_id=row.item_id and deleted_at is null) then raise exception 'edited aggregate mismatch';end if;
 if not exists(select 1 from rls_internal.production_material_load_audit where load_id=row.id and action='edit') then raise exception 'audit missing';end if;
 execute 'set local role authenticated';
 begin
  perform public.production_material_load_action('edit',jsonb_build_object('id',row.id,'version',coalesce(row.updated_at,row.created_at),'quantity',999));
  raise exception 'stale version accepted';
 exception when others then if sqlerrm<>'ps_load_changed' then raise;end if;end;
 execute 'reset role';
 select * into row from public.production_material_loads where id=row.id;
 perform set_config('request.jwt.claim.sub',(select m.user_id::text from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo and m.role='lider' limit 1),true);
 execute 'set local role authenticated';
 perform public.production_material_load_action('delete',jsonb_build_object('id',row.id,'version',row.updated_at));
 snap:=public.production_supply_snapshot();
 if exists(select 1 from jsonb_array_elements(snap->'loads') l where l->>'id'=row.id::text) then raise exception 'deleted load visible';end if;
 execute 'reset role';
 if not exists(select 1 from rls_internal.production_material_load_audit where load_id=row.id and action='delete') then raise exception 'delete audit missing';end if;
 perform set_config('request.jwt.claim.sub',(select m.user_id::text from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.department='production' and m.active and o.activo and m.role='operador' limit 1),true);
 execute 'set local role authenticated';
 begin
  perform public.production_material_load_action('edit',jsonb_build_object('id',row.id,'version',row.updated_at,'quantity',888));
  raise exception 'operator edited load';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 execute 'reset role';
end $test$;
rollback;
