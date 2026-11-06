-- Run against a populated app database. All fixtures and role changes roll back.
begin;
do $test$
declare
 admin_uid uuid;
 operator_uid uuid;
 outsider_uid uuid;
 inactive_uid uuid;
 actor uuid;
 label text;
 allowed boolean;
 n integer;
 test_po text := '__RLS_CATALOG_TEST_' || gen_random_uuid()::text;
 fixture_id bigint := -900000000000000001;
begin
 select o.uid into admin_uid from public.operadores o join public.global_system_admins a on a.user_id=o.uid where o.activo limit 1;
 select o.uid into operator_uid from public.operadores o join public.global_department_memberships m on m.user_id=o.uid where o.activo and m.department='catalogs' and m.active and m.role='operador' and not exists(select 1 from public.global_system_admins a where a.user_id=o.uid) limit 1;
 select o.uid into outsider_uid from public.operadores o where o.activo and o.uid is not null and not exists(select 1 from public.global_department_memberships m where m.user_id=o.uid and m.department='catalogs' and m.active) and not exists(select 1 from public.global_system_admins a where a.user_id=o.uid) limit 1;
 select o.uid into inactive_uid from public.operadores o join public.global_department_memberships m on m.user_id=o.uid where not o.activo and m.department='catalogs' and m.active limit 1;
 if admin_uid is null or operator_uid is null or outsider_uid is null or inactive_uid is null then raise exception 'Test actors unavailable';end if;
 foreach label in array array['admin','catalog_lider','catalog_supervisor','catalog_operator','other_department','inactive','signed_out','anon'] loop
  actor:=case when label='admin' then admin_uid when label like 'catalog_%' then operator_uid when label='inactive' then inactive_uid when label='other_department' then outsider_uid else null end;
  allowed:=label in ('admin','catalog_lider','catalog_supervisor');
  if label like 'catalog_%' then update public.global_department_memberships set role=case label when 'catalog_lider' then 'lider' when 'catalog_supervisor' then 'supervisor' else 'operador' end where user_id=operator_uid and department='catalogs';end if;
  insert into public.catalogo_pos(id,po,consignee_name) values(fixture_id,test_po,'original');
  insert into public.catalogo_shipper(id,shipper_name) values(fixture_id,test_po);
  perform set_config('request.jwt.claim.sub',coalesce(actor::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when label='anon' then 'anon' else 'authenticated' end)::text,true);
  execute case when label='anon' then 'set local role anon' else 'set local role authenticated' end;
  begin
   insert into public.catalogo_pos(id,po) values(fixture_id-1,test_po||'_insert');
   if not allowed then raise exception 'Unauthorized PO INSERT: %',label;end if;
  exception when insufficient_privilege then if allowed then raise exception 'Authorized PO INSERT blocked: %',label;end if;end;
  begin
   insert into public.catalogo_shipper(id,shipper_name) values(fixture_id-1,test_po||'_insert');
   if not allowed then raise exception 'Unauthorized Shipper INSERT: %',label;end if;
  exception when insufficient_privilege then if allowed then raise exception 'Authorized Shipper INSERT blocked: %',label;end if;end;
  begin
   update public.catalogo_pos set consignee_name='updated' where id=fixture_id;get diagnostics n=row_count;
   if n<>(case when allowed then 1 else 0 end) then raise exception 'Unexpected PO UPDATE: %',label;end if;
   update public.catalogo_shipper set shipper_name=test_po||'_updated' where id=fixture_id;get diagnostics n=row_count;
   if n<>(case when allowed then 1 else 0 end) then raise exception 'Unexpected Shipper UPDATE: %',label;end if;
  exception when insufficient_privilege then if allowed then raise;end if;end;
  if allowed then
   insert into public.bill_charges_to(po,bill_to_name) values(test_po,'Billing test') on conflict(po) do update set bill_to_name=excluded.bill_to_name;
   insert into public.bill_charges_to(po,bill_to_name) values(test_po,'Billing updated') on conflict(po) do update set bill_to_name=excluded.bill_to_name;
   select count(*) into n from public.bill_charges_to where po=test_po and bill_to_name='Billing updated';if n<>1 then raise exception 'PO billing upsert failed';end if;
   select count(*) into n from public.catalogo_pos where id=fixture_id and consignee_name='updated';if n<>1 then raise exception 'PO SELECT/UPDATE failed';end if;
  end if;
  begin
   delete from public.catalogo_pos where id=fixture_id;get diagnostics n=row_count;
   if n<>(case when allowed then 1 else 0 end) then raise exception 'Unexpected PO DELETE: %',label;end if;
   delete from public.catalogo_shipper where id=fixture_id;get diagnostics n=row_count;
   if n<>(case when allowed then 1 else 0 end) then raise exception 'Unexpected Shipper DELETE: %',label;end if;
  exception when insufficient_privilege then if allowed then raise;end if;end;
  reset role;
  delete from public.catalogo_pos where id in(fixture_id,fixture_id-1);
  delete from public.catalogo_shipper where id in(fixture_id,fixture_id-1);
 end loop;
end $test$;
rollback;
