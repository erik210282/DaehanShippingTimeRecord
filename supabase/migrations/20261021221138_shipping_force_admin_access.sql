-- General administrators have Shipping access without a redundant department assignment.
-- Active Shipping leaders and supervisors retain the same authority; operators do not.
create or replace function rls_internal.shipping_can_force_finish()
returns boolean language sql stable security definer set search_path='' as $$
 select public.inventory_access('shipping') and (
   exists(select 1 from public.global_system_admins where user_id=auth.uid())
   or exists(select 1 from public.global_department_memberships
     where user_id=auth.uid() and department='shipping' and active
       and role in ('lider','supervisor'))
 );
$$;
revoke all on function rls_internal.shipping_can_force_finish() from public,anon;
grant execute on function rls_internal.shipping_can_force_finish() to authenticated;
