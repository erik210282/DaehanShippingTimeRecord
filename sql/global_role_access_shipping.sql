create or replace function rls_internal.check_shipping_role_activity()
returns trigger language plpgsql security definer set search_path='' as $$
declare activity text;
begin
 -- Service integrations retain their server-side authorization.
 if auth.uid() is null and (auth.jwt()->>'role')='service_role' then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if tg_op='INSERT' then activity:='start';
 elsif tg_op='DELETE' then activity:='records';
 elsif new.hora_fin is distinct from old.hora_fin then activity:='finish';
 else activity:='start';end if;
 if tg_op='DELETE' and not public.inventory_access('shipping',true) then raise exception 'ra_denied';end if;
 if not rls_internal.role_activity_access('shipping',activity) and not (tg_op<>'INSERT' and public.inventory_access('shipping',true) and rls_internal.role_activity_access('shipping','records')) then raise exception 'ra_denied';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function rls_internal.check_shipping_role_activity() from public,anon,authenticated;
create trigger shipping_role_activity before insert or update or delete on public.actividades_realizadas for each row execute function rls_internal.check_shipping_role_activity();
