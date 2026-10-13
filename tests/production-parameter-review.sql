begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare report public.production_parameter_checks;request public.production_parameter_requests;field jsonb;payload jsonb;snapshot jsonb;version_now integer;actor uuid;
begin
 select c.* into report from public.production_parameter_checks c join public.production_parameter_requests r on r.id=c.capture_group_id where r.deleted_at is null order by c.recorded_at desc limit 1;
 if report.id is null then raise exception 'parameter review test fixture missing';end if;
 select * into request from public.production_parameter_requests where id=report.capture_group_id;
 payload:=jsonb_build_object('id',request.id,'version',request.version,'date',report.recorded_date,'time',to_char(report.recorded_time,'HH24MI'),'note','Supervisor test correction','values',(select jsonb_agg(jsonb_build_object('id',x->>'id','value',x->>'value','note','Corrected note')) from jsonb_array_elements(report.readings)x));
 perform public.production_parameter_review('edit',payload);
 if exists(select 1 from public.production_parameter_checks where capture_group_id=request.id and (leader_id<>report.leader_id or leader_name<>report.leader_name or readings->0->>'reference' is distinct from report.readings->0->>'reference' or note<>'Supervisor test correction')) then raise exception 'edit lost reporter or historical reference';end if;
 select version into version_now from public.production_parameter_requests where id=request.id;
 if version_now<>request.version+1 then raise exception 'edit did not increment version';end if;
 begin
  perform public.production_parameter_review('delete',jsonb_build_object('id',request.id,'version',request.version));
  raise exception 'stale delete accepted';
 exception when others then if sqlerrm<>'pp_changed' then raise;end if;end;
 select user_id into actor from public.global_department_memberships where department='production' and active and user_id not in(select user_id from public.global_system_admins) limit 1;
 update public.global_department_memberships set role='lider' where user_id=actor and department='production';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.production_parameter_review('edit',payload||jsonb_build_object('version',version_now));
  raise exception 'leader edited supervisor-only record';
 exception when others then if sqlerrm<>'ra_denied' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 perform public.production_parameter_review('delete',jsonb_build_object('id',request.id,'version',version_now));
 snapshot:=public.production_parameter_snapshot(report.recorded_date,report.recorded_date,'','',false);
 if exists(select 1 from jsonb_array_elements(snapshot->'reports')x where x->>'capture_group_id'=request.id::text) then raise exception 'deleted capture visible in history';end if;
 if not exists(select 1 from public.production_parameter_checks where capture_group_id=request.id) then raise exception 'delete destroyed audit history';end if;
end $test$;
rollback;
