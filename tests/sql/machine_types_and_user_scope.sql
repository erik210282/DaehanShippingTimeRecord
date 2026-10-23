-- Run inside a transaction after the migration; always roll back the fixtures.
create temp table qa_people(label text primary key,id uuid default gen_random_uuid());
insert into qa_people(label) values('admin'),('supervisor'),('production'),('shipping'),('dual'),('inactive');
grant select on qa_people to authenticated;
insert into auth.users(id) select id from qa_people;
insert into public.operadores(id,uid,nombre,activo,role) select id,id,'QA '||label,label<>'inactive','operador' from qa_people;
insert into public.global_system_admins(user_id) select id from qa_people where label='admin';
insert into public.global_department_memberships(user_id,department,role,active)
select id,'production',case when label='supervisor' then 'supervisor' else 'operador' end,true from qa_people where label in ('supervisor','production','dual','inactive');
insert into public.global_department_memberships(user_id,department,role,active)
select id,'shipping','operador',true from qa_people where label in ('shipping','dual');

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_people where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare n int;template_id uuid:=gen_random_uuid();payload jsonb;begin
 select count(*) into n from public.operadores where uid in(select id from qa_people);if n<>6 then raise exception 'Admin lost global visibility: %',n;end if;
 insert into public.machine_types(name) values('QA New Type');
 insert into public.inventory_workstations(code,name,machine_type) values('QA-CATALOG-TYPE','QA Workstation','QA New Type');
 payload:=jsonb_build_object('id',template_id,'name','QA Catalog Template','machine_types',jsonb_build_array('QA New Type'),'fields',jsonb_build_array(jsonb_build_object('id','qa-field','label','QA Reading','input_type','numeric')));
 perform public.production_parameter_action('template',payload);
 update public.machine_types set name='QA Renamed Type' where name='QA New Type';
 if not exists(select 1 from public.inventory_workstations where code='QA-CATALOG-TYPE' and machine_type='QA Renamed Type') then raise exception 'Rename failed to update workstation';end if;
 if not exists(select 1 from public.production_parameter_templates where id=template_id and machine_types=array['QA Renamed Type'] and version=2) then raise exception 'Rename failed to update template and version';end if;
 begin delete from public.machine_types where name='QA Renamed Type';raise exception 'Referenced type deleted';exception when others then if sqlerrm<>'mt_in_use' then raise;end if;end;
 update public.machine_types set active=false where name='QA Renamed Type';
 perform public.production_parameter_action('template',payload||jsonb_build_object('machine_types',jsonb_build_array('QA Renamed Type'),'version',2));
 begin perform public.production_parameter_action('template',payload||jsonb_build_object('id',gen_random_uuid(),'machine_types',jsonb_build_array('QA Renamed Type')));raise exception 'New template accepted inactive type';exception when others then if sqlerrm<>'mt_invalid' then raise;end if;end;
 update public.inventory_workstations set name='QA Still Editable' where code='QA-CATALOG-TYPE';
 begin insert into public.inventory_workstations(code,name,machine_type) values('QA-BAD-TYPE','QA','QA Renamed Type');raise exception 'Inactive type accepted';exception when others then if sqlerrm<>'mt_invalid' then raise;end if;end;
 begin insert into public.inventory_workstations(code,name,machine_type) values('QA-BAD-TYPE','QA','Forged Type');raise exception 'Unknown type accepted';exception when others then if sqlerrm<>'mt_invalid' then raise;end if;end;
 insert into public.machine_types(name) values('QA Delete Type');delete from public.machine_types where name='QA Delete Type';
 if exists(select 1 from public.machine_types where name='QA Delete Type') then raise exception 'Unused type delete failed';end if;
 if (select count(*) from public.production_downtime_codes where code='D1')<>3 then raise exception 'D1 grouping missing';end if;
 if (select count(*) from public.production_downtime_codes where code='D1' and fixed_type is not null)<>2 then raise exception 'Training has fixed duration';end if;
 begin update public.production_downtime_codes set active=false where fixed_type='break';raise exception 'Fixed Break was changed';exception when others then if sqlerrm<>'dt_fixed_locked' then raise;end if;end;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_people where label='supervisor'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare n int;begin
 if exists(select 1 from public.operadores where uid=(select id from qa_people where label='shipping')) then raise exception 'Supervisor read other department';end if;
 select count(*) into n from public.operadores where uid in(select id from qa_people);if n<>4 then raise exception 'Supervisor roster wrong: %',n;end if;
 update public.global_department_memberships set role='lider' where user_id=(select id from qa_people where label='production') and department='production';
 if not found then raise exception 'Supervisor cannot manage own department';end if;
 begin insert into public.global_department_memberships(user_id,department,role) values((select id from qa_people where label='shipping'),'production','operador');raise exception 'Blind cross-department assignment accepted';exception when insufficient_privilege then null;end;
 begin insert into public.global_department_memberships(user_id,department,role) values((select id from qa_people where label='production'),'shipping','operador');raise exception 'Cross-department assignment accepted';exception when insufficient_privilege then null;end;
 begin update public.operadores set role='supervisor' where uid=auth.uid();raise exception 'Direct profile escalation accepted';exception when insufficient_privilege then null;end;
 begin
  update public.global_department_memberships set role='supervisor' where user_id=(select id from qa_people where label='production') and department='production';
  if found then raise exception 'Supervisor promoted another supervisor';end if;
 exception when insufficient_privilege then null;end;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_people where label='inactive'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin if exists(select 1 from public.operadores where uid<>auth.uid()) then raise exception 'Inactive user read colleagues';end if;end $$;
reset role;
set local role anon;
do $$begin
 begin perform * from public.operadores;raise exception 'Anonymous users read profiles';exception when insufficient_privilege then null;end;
 begin perform * from public.machine_types;raise exception 'Anonymous users read catalog';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: catalog CRUD, rename, inactive/unknown validation, D1 semantics, admin/supervisor/inactive/anonymous boundaries' result;
