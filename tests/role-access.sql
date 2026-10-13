begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare op uuid;v integer;before_roles integer;after_roles integer;
begin
 select version into v from public.global_role_access_profiles where department='production' and role='operador';
 if v is null then raise exception 'missing role profile';end if;
 perform public.save_role_access('production','operador',array['records'],v);
 begin
  perform public.save_role_access('production','operador',array['records'],v);
  raise exception 'stale permissions accepted';
 exception when others then if sqlerrm<>'ra_changed' then raise;end if;end;
 begin
  perform public.save_role_access('production','operador',array['parameter-settings'],v+1);
  raise exception 'operator was granted supervisor authority';
 exception when others then if sqlerrm<>'ra_invalid' then raise;end if;end;
 select user_id into op from public.global_department_memberships where department='production' and active and user_id not in (select user_id from public.global_system_admins) limit 1;
 if op is null then raise exception 'test membership missing';end if;
 update public.global_department_memberships set role='operador' where user_id=op and department='production';
 perform set_config('request.jwt.claim.sub',op::text,true);
 if rls_internal.role_activity_access('production','partial') then raise exception 'revoked progress permission still granted';end if;
 if not rls_internal.role_activity_access('production','records') then raise exception 'allowed daily permission rejected';end if;
 begin
  perform public.production_live_action('checkpoint','{}');
  raise exception 'revoked action reached handler';
 exception when others then if sqlerrm<>'ra_denied' then raise;end if;end;
 begin
  perform public.save_role_access('production','operador',array['partial'],v+1);
  raise exception 'operator edited own permissions';
 exception when others then if sqlerrm<>'ra_denied' then raise;end if;end;
end $test$;
rollback;
