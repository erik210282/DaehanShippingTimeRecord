
begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare tpl uuid:=gen_random_uuid();request uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();station text:='PARAM-TEST-'||substr(gen_random_uuid()::text,1,8);field jsonb;cfg jsonb;capture jsonb;snap jsonb;leader uuid;supervisor uuid:=auth.uid();n integer;
begin
 insert into public.inventory_workstations(code,name,machine_type) values(station,'Parameter test','Foaming');
 insert into public.inventory_items(id,part_number,category) values(a,'PARAM-A-'||a,'SEMI'),(b,'PARAM-B-'||b,'SEMI');
 field:=jsonb_build_object('id','pressure','label','Pressure','input_type','numeric','unit','MPa','reference','4 ± 2 MPa','minimum',2,'maximum',6);
 cfg:=jsonb_build_object('id',tpl,'name','Parameter test','machine_types',jsonb_build_array('Foaming'),'fields',jsonb_build_array(field));
 perform public.production_parameter_action('template',cfg);
 capture:=jsonb_build_object('id',request,'template_id',tpl,'template_version',1,'station_code',station,'item_ids',jsonb_build_array(a,b),'recorded_at',clock_timestamp()-interval '5 minutes','timezone','America/Monterrey','shift','Day','leader_name','SPOOFED','values',jsonb_build_array(jsonb_build_object('id','pressure','value','10','note','Measured outside reference')));
 perform public.production_parameter_action('capture',capture);
 perform public.production_parameter_action('capture',capture);
 if (select count(*) from public.production_parameter_checks where capture_group_id=request)<>1 then raise exception 'multi product/retry duplicated or lost reports';end if;
 if (select jsonb_array_length(products) from public.production_parameter_checks where capture_group_id=request)<>2 then raise exception 'machine capture lost associated products';end if;
 if exists(select 1 from public.production_parameter_checks where capture_group_id=request and (not out_of_range or template_version<>1 or leader_name='SPOOFED' or readings->0->>'maximum'<>'6')) then raise exception 'range or reporter snapshot invalid';end if;
 perform public.production_parameter_action('template',cfg||jsonb_build_object('version',1,'fields',jsonb_build_array(field||jsonb_build_object('reference','100 ± 10 MPa','minimum',90,'maximum',110))));
 if exists(select 1 from public.production_parameter_checks where capture_group_id=request and readings->0->>'reference'<>'4 ± 2 MPa') then raise exception 'config changed historical reference';end if;
 begin
  perform public.production_parameter_action('capture',capture||jsonb_build_object('id',gen_random_uuid()));
  raise exception 'stale configuration accepted';
 exception when others then if sqlerrm<>'pp_changed' then raise;end if;end;
 update public.global_department_memberships set role='operador' where user_id='9c45902c-ee83-4716-9f70-d8e7fe8e8b0d'::uuid and department='production' and active;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 begin
  perform public.production_parameter_action('capture',capture||jsonb_build_object('id',gen_random_uuid(),'template_version',2));
  raise exception 'operator captured leader parameters';
 exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 -- Exercise the leader role inside the rolled-back transaction; no permission change persists.
 update public.global_department_memberships set role='lider' where user_id='9c45902c-ee83-4716-9f70-d8e7fe8e8b0d'::uuid and department='production' and active;
 if not found then raise exception 'leader test fixture unavailable';end if;
 select user_id into leader from public.global_department_memberships where department='production' and active and role='lider' limit 1;
 if leader is not null then
  perform set_config('request.jwt.claim.sub',leader::text,true);
  perform public.production_parameter_action('capture',capture||jsonb_build_object('id',gen_random_uuid(),'template_version',2));
  snap:=public.production_parameter_snapshot(current_date-1,current_date+1,station,'',false);
  if exists(select 1 from jsonb_array_elements(snap->'reports')x where x->>'leader_id'<>leader::text) then raise exception 'leader read other reports';end if;
  begin
   perform public.production_parameter_action('template',cfg||jsonb_build_object('version',2));
   raise exception 'leader changed supervisor config';
  exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
 end if;
 perform set_config('request.jwt.claim.sub',supervisor::text,true);
 snap:=public.production_parameter_snapshot(current_date-1,current_date+1,station,'',true);
 if (snap->>'total')::integer<2 then raise exception 'supervisor cannot query captured reports';end if;
 perform public.production_parameter_action('archive',jsonb_build_object('id',tpl,'version',2));
 if (select count(*) from public.production_parameter_checks where template_id=tpl)<2 then raise exception 'deactivation removed history';end if;
 begin
  perform public.production_parameter_action('capture',capture||jsonb_build_object('id',gen_random_uuid(),'template_version',3));
  raise exception 'inactive template accepted';
 exception when others then if sqlerrm<>'pp_changed' then raise;end if;end;
end $test$;
rollback;
