begin;
create temp table qa_shipping_task as select * from public.tareas_pendientes with no data;
create trigger qa_task_guard before insert or update on qa_shipping_task for each row execute function public.operator_guard_task_assignment();
create temp table qa_shipping_activity as select * from public.actividades_realizadas with no data;
create trigger qa_activity_guard before insert or update on qa_shipping_activity for each row execute function public.operator_guard_activity_assignment();
do $qa$
declare
 admin_id uuid:=gen_random_uuid(); ship_id uuid:=gen_random_uuid(); prod_id uuid:=gen_random_uuid(); dual_id uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid(); unassigned_id uuid:=gen_random_uuid();
 roster jsonb; denied boolean; d text;
begin
 insert into auth.users(id) values(admin_id),(ship_id),(prod_id),(dual_id),(disabled_id),(unassigned_id);
 insert into public.operadores(id,uid,nombre,activo,role) values
 (admin_id,admin_id,'QA Admin',true,'supervisor'),(ship_id,ship_id,'QA Shipping',true,'operador'),
 (prod_id,prod_id,'QA Production',true,'operador'),(dual_id,dual_id,'QA Dual',true,'lider'),
 (disabled_id,disabled_id,'QA Disabled',false,'operador'),(unassigned_id,unassigned_id,'QA Unassigned',true,'supervisor');
 insert into public.global_system_admins(user_id) values(admin_id);
 insert into public.global_department_memberships(user_id,department,role,active) values
 (ship_id,'shipping','operador',true),(prod_id,'production','operador',true),
 (dual_id,'shipping','lider',true),(dual_id,'production','operador',true),(disabled_id,'shipping','operador',true),
 (unassigned_id,'shipping','supervisor',false);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 roster:=public.department_operators('shipping');
 if not roster @> jsonb_build_array(jsonb_build_object('id',ship_id)) or not roster @> jsonb_build_array(jsonb_build_object('id',dual_id)) then raise exception 'Missing assigned Shipping users'; end if;
 if roster @> jsonb_build_array(jsonb_build_object('id',prod_id)) or roster @> jsonb_build_array(jsonb_build_object('id',admin_id)) or roster @> jsonb_build_array(jsonb_build_object('id',unassigned_id)) or roster @> jsonb_build_array(jsonb_build_object('id',disabled_id)) then raise exception 'Unassigned/inactive users leaked'; end if;
 foreach d in array array['shipping','production','receiving','quality','inventory'] loop
   roster:=public.department_operators(d);
   if exists(select 1 from jsonb_array_elements(roster) r where not exists(select 1 from public.global_department_memberships m join public.operadores o on o.uid=m.user_id where m.active and m.department=d and o.activo and o.id::text=r->>'id')) then raise exception 'Roster mismatch for %',d; end if;
 end loop;
 if not public.department_operators('shipping',true) @> jsonb_build_array(jsonb_build_object('id',disabled_id)) then raise exception 'Supervisor cannot manage inactive assigned users'; end if;
 -- Use an actual authenticated role: members see colleagues despite self-only membership RLS.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ship_id,'role','authenticated')::text,true);
 set local role authenticated;
 roster:=public.department_operators('shipping');
 if not roster @> jsonb_build_array(jsonb_build_object('id',dual_id)) then raise exception 'Operator cannot see department colleague'; end if;
 denied:=false;begin perform public.department_operators('production');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-department roster accepted';end if;
 denied:=false;begin perform public.department_operators('shipping',true);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Operator requested inactive users';end if;
 reset role;
 insert into qa_shipping_task(operadores,estado) values(array[ship_id::text],'pendiente');
 denied:=false;begin insert into qa_shipping_task(operadores,estado) values(array[prod_id::text],'pendiente');exception when others then if sqlerrm not like '%asignado a Shipping%' then raise;end if;denied:=true;end;if not denied then raise exception 'Cross-department task assignment accepted';end if;
 insert into qa_shipping_activity(operadores,estado) values(jsonb_build_array(ship_id),'iniciada');
 denied:=false;begin insert into qa_shipping_activity(operadores,estado) values(jsonb_build_array(prod_id),'finalizada');exception when others then if sqlerrm not like '%asignado a Shipping%' then raise;end if;denied:=true;end;if not denied then raise exception 'Cross-department activity assignment accepted';end if;
 update public.global_department_memberships set active=false where user_id=ship_id and department='shipping';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 update qa_shipping_activity set estado='finalizada';update qa_shipping_task set estado='finalizada';
 if not exists(select 1 from qa_shipping_activity where operadores ? ship_id::text and estado='finalizada') then raise exception 'Historical participant was lost';end if;
 if public.department_operators('shipping') @> jsonb_build_array(jsonb_build_object('id',ship_id)) then raise exception 'Revoked assignment still in roster';end if;
 perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.department_operators('shipping');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anonymous roster accepted';end if;
 if has_function_privilege('anon','public.department_operators(text,boolean)','execute') or has_function_privilege('anon','rls_internal.department_operators(text,boolean)','execute') then raise exception 'Anonymous function grant';end if;
end $qa$;

rollback;
