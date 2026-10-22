-- Department membership is the source of truth, including users with multiple assignments.
-- The private lookup deliberately reads memberships across their self-only SELECT policy;
-- the public invoker wrapper exposes only a roster for an authorized department.
create or replace function rls_internal.department_operators(p_department text, p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  if auth.uid() is null or not public.inventory_access(p_department)
     or p_department not in ('shipping','production','receiving','quality','inventory') then
    raise exception 'Department access required' using errcode = '42501';
  end if;
  if p_include_inactive and not global_private.can_manage_department(p_department) then
    raise exception 'Department supervisor access required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'uid',o.uid,'nombre',o.nombre,'email',o.email,
    'role',m.role,'activo',o.activo,'inactive_since',o.inactive_since,'assigned',true
  ) order by o.activo desc,o.nombre,o.id)
  from public.operadores o join public.global_department_memberships m on m.user_id=o.uid
  where m.department=p_department and m.active is true
    and (o.activo is true or p_include_inactive)), '[]'::jsonb);
end $function$;
revoke all on function rls_internal.department_operators(text,boolean) from public,anon;
grant execute on function rls_internal.department_operators(text,boolean) to authenticated;
create or replace function public.department_operators(p_department text, p_include_inactive boolean default false)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select rls_internal.department_operators(p_department,p_include_inactive);
$function$;
revoke all on function public.department_operators(text,boolean) from public,anon;
grant execute on function public.department_operators(text,boolean) to authenticated;

create or replace function public.operator_guard_task_assignment()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare v_id text; v_allowed jsonb;
begin
  if new.estado in ('pendiente','iniciada','pausada') then
    foreach v_id in array coalesce(new.operadores,array[]::text[]) loop
      -- Preserve existing assignments when closing/resuming older activities.
      if tg_op='UPDATE' then
        if v_id=any(coalesce(old.operadores,array[]::text[])) then continue; end if;
      end if;
      if v_allowed is null then v_allowed:=public.department_operators('shipping'); end if;
      if not exists(select 1 from jsonb_array_elements(v_allowed) o where o->>'id'=v_id) then
        raise exception 'El operador debe estar activo y asignado a Shipping';
      end if;
    end loop;
  end if;
  return new;
end $function$;

create or replace function public.operator_guard_activity_assignment()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare v_id text; v_allowed jsonb;
begin
  if new.operadores is null then return new; end if;
  if jsonb_typeof(new.operadores)<>'array' then raise exception 'La lista de operadores no es válida'; end if;
  for v_id in select jsonb_array_elements_text(new.operadores) loop
    -- Existing participants remain in historical records after reassignment/deactivation.
    if tg_op='UPDATE' then
      if old.operadores ? v_id then continue; end if;
    end if;
    if v_allowed is null then v_allowed:=public.department_operators('shipping'); end if;
    if not exists(select 1 from jsonb_array_elements(v_allowed) o where o->>'id'=v_id) then
      raise exception 'El operador debe estar activo y asignado a Shipping';
    end if;
  end loop;
  return new;
end $function$;
