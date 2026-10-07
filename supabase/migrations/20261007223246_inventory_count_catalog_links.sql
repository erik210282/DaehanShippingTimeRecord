
begin;
do $$ declare v_definition text; begin
select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rls_internal' and p.proname='inventory_submit_count';
v_definition:=replace(v_definition,'i.responsible_department=p_department','(i.responsible_department=p_department or p_department=''inventory'')');
execute v_definition;
end $$;
create or replace function rls_internal.link_catalog_recipe() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.category='FG' then
  update public.inventory_boms set finished_item_id=new.id where finished_item_id is null and product_part_number=new.part_number and not archived;
 end if;
 return new;
end $$;
revoke all on function rls_internal.link_catalog_recipe() from public,anon,authenticated;
create trigger inventory_link_catalog_recipe after insert or update of part_number on public.inventory_items for each row execute function rls_internal.link_catalog_recipe();
alter publication supabase_realtime add table public.inventory_workstations;
commit;