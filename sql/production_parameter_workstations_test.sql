begin;
set local jit=off;
do $$
declare uid uuid; tid uuid:=gen_random_uuid(); capture uuid:=gen_random_uuid(); product uuid; payload jsonb; snap jsonb; a text; b text; machine text; tpl public.production_parameter_templates;
begin
 select user_id into uid from public.global_system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 select machine_type into machine from public.inventory_workstations where active group by machine_type having count(*)>1 limit 1;
 select code into a from public.inventory_workstations where active and machine_type=machine order by code limit 1;
 select code into b from public.inventory_workstations where active and machine_type=machine and code<>a order by code limit 1;
 if a is null or b is null then raise exception 'Need two active workstations';end if;
 payload:=jsonb_build_object('id',tid,'name','Workstation rollback test','machine_types',jsonb_build_array(machine),'station_codes',jsonb_build_array(a,b),'item_ids','[]'::jsonb,'fields',jsonb_build_array(jsonb_build_object('id','f','label','Pressure','input_type','numeric','reference','2,000-4,000','minimum',2000,'maximum',4000)));
 perform public.production_parameter_action('template',payload);
 select * into tpl from public.production_parameter_templates where id=tid;
 if cardinality(tpl.station_codes)<>2 or not(a=any(tpl.station_codes)) or not(b=any(tpl.station_codes)) or tpl.station_code is not null then raise exception 'Multiple stations lost';end if;
 select id into product from public.inventory_items where active and category in ('FG','SEMI') limit 1;
 perform public.production_parameter_action('capture',jsonb_build_object('id',capture,'station_code',b,'item_ids',jsonb_build_array(product),'template_id',tid,'template_version',tpl.version,'recorded_at',now()-interval '1 minute','timezone','UTC','values',jsonb_build_array(jsonb_build_object('id','f','value','2500'))));
 if not exists(select 1 from public.production_parameter_checks where capture_group_id=capture and station_code=b and not out_of_range) then raise exception 'Second station capture failed';end if;
 begin
  perform public.production_parameter_action('template',payload||jsonb_build_object('version',tpl.version,'station_codes',jsonb_build_array(a,'INVALID-WORKSTATION')));
  raise exception 'Invalid station accepted';
 exception when others then if sqlerrm<>'pr_station_required' then raise;end if;end;
 begin
  perform public.production_parameter_action('delete-template',jsonb_build_object('id',tid,'version',tpl.version));
  raise exception 'Active delete accepted';
 exception when others then if sqlerrm<>'pp_deactivate_first' then raise;end if;end;
 perform public.production_parameter_action('archive',jsonb_build_object('id',tid,'version',tpl.version));
 perform public.production_parameter_action('reactivate',jsonb_build_object('id',tid,'version',tpl.version+1));
 if not(select active from public.production_parameter_templates where id=tid) then raise exception 'Reactivation failed';end if;
 begin
  perform public.production_parameter_action('archive',jsonb_build_object('id',tid,'version',tpl.version));
  raise exception 'Stale edit accepted';
 exception when others then if sqlerrm<>'pp_changed' then raise;end if;end;
 perform public.production_parameter_action('archive',jsonb_build_object('id',tid,'version',tpl.version+2));
 perform public.production_parameter_action('delete-template',jsonb_build_object('id',tid,'version',tpl.version+3));
 if not exists(select 1 from public.production_parameter_templates where id=tid and deleted_at is not null and not active) then raise exception 'History retention failed';end if;
 if not exists(select 1 from public.production_parameter_checks where capture_group_id=capture and readings->0->>'reference'='2,000-4,000') then raise exception 'Historical reading lost';end if;
 snap:=public.production_parameter_snapshot(current_date,current_date);
 if exists(select 1 from jsonb_array_elements(snap->'templates') t where t->>'id'=tid::text) then raise exception 'Deleted config visible';end if;
 -- Older clients still saving one station keep their intended scope.
 payload:=(payload-'station_codes')||jsonb_build_object('id',gen_random_uuid(),'station_code',a);
 perform public.production_parameter_action('template',payload);
 if not exists(select 1 from public.production_parameter_templates where id=(payload->>'id')::uuid and station_codes=array[a]) then raise exception 'Legacy scope lost';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.production_parameter_action('reactivate',jsonb_build_object('id',tid,'version',1));
  raise exception 'Anonymous write accepted';
 exception when others then if sqlerrm not in ('ra_denied','pr_forbidden') then raise;end if;end;
end $$;
rollback;
