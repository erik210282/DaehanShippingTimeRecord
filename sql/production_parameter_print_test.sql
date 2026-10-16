begin;
do $$
declare uid uuid; snap jsonb;
begin
 select user_id into uid from public.global_system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 snap:=public.production_parameter_snapshot(current_date-60,current_date);
 if not exists(select 1 from jsonb_array_elements(snap->'staff') x where x->>'role'='supervisor') then raise exception 'Production supervisors missing';end if;
 if exists(select 1 from jsonb_array_elements(snap->'staff') x where x ? 'email') then raise exception 'Unnecessary contact data exposed';end if;
 select user_id into uid from public.global_department_memberships where department='production' and role='lider' and active limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 snap:=public.production_parameter_snapshot(current_date-60,current_date);
 if exists(select 1 from jsonb_array_elements(snap->'reports') x where x->>'leader_id'<>uid::text) then raise exception 'Leader can view another author records';end if;
 if exists(select 1 from jsonb_array_elements(snap->'reports') x where x->>'author_role'<>'lider') then raise exception 'Leader role missing';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.production_parameter_snapshot(current_date,current_date);raise exception 'Anonymous access allowed';exception when others then if sqlerrm<>'pr_forbidden' then raise;end if;end;
end $$;
rollback;
