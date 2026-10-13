
create or replace function rls_internal.production_parameter_snapshot(p_from date,p_to date,p_station text default '',p_search text default '',p_outside boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare manager boolean; reports jsonb; total integer;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or length(coalesce(p_search,''))>100 then raise exception 'pr_time_invalid';end if;
 manager:=public.inventory_access('production',true);
 select count(*) into total from public.production_parameter_checks c where (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station) and (coalesce(p_search,'')='' or concat_ws(' ',c.part_number,c.part_name,c.leader_name,c.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or c.out_of_range);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.recorded_at desc,x.id),'[]') into reports from (
  select c.* from public.production_parameter_checks c where (manager or c.leader_id=auth.uid()) and c.recorded_date between p_from and p_to and (coalesce(p_station,'')='' or c.station_code=p_station) and (coalesce(p_search,'')='' or concat_ws(' ',c.part_number,c.part_name,c.leader_name,c.template_name) ilike '%'||p_search||'%') and (not coalesce(p_outside,false) or c.out_of_range) order by recorded_at desc,id limit 500
 )x;
 return jsonb_build_object('templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.production_parameter_templates t),'reports',reports,'total',total);
end $$;
create or replace function public.production_parameter_snapshot(p_from date,p_to date,p_station text default '',p_search text default '',p_outside boolean default false)
returns jsonb language sql set search_path='' as $$ select rls_internal.production_parameter_snapshot(p_from,p_to,p_station,p_search,p_outside) $$;
revoke all on function public.production_parameter_snapshot(date,date,text,text,boolean),rls_internal.production_parameter_snapshot(date,date,text,text,boolean) from public,anon;
grant execute on function public.production_parameter_snapshot(date,date,text,text,boolean),rls_internal.production_parameter_snapshot(date,date,text,text,boolean) to authenticated;

do $seed$
declare spec jsonb; fields jsonb;
begin
 for spec in select jsonb_array_elements($json$[{"name":"Foaming / Turn Table","machine_types":["Foaming"],"fields":[{"key":"pump_iso","label":"Pump pressure ISO","unit":"kg/cm²","reference":"102 ± 20 kg/cm²","minimum":82,"maximum":122,"input_type":"numeric"},{"key":"pump_poly","label":"Pump pressure POLY","unit":"kg/cm²","reference":"102 ± 20 kg/cm²","minimum":82,"maximum":122,"input_type":"numeric"},{"key":"tank_iso","label":"Tank pressure ISO","unit":"kg/cm²","reference":"2–8 kg/cm²","minimum":2,"maximum":8,"input_type":"numeric"},{"key":"tank_poly","label":"Tank pressure POLY","unit":"kg/cm²","reference":"2–8 kg/cm²","minimum":2,"maximum":8,"input_type":"numeric"},{"key":"hyd_oil","label":"Hydraulic oil pressure","unit":"kg/cm²","reference":"120–200 kg/cm²","minimum":120,"maximum":200,"input_type":"numeric"},{"key":"water_temp","label":"Water temperature","unit":"°C","reference":"70 ± 10 °C","minimum":60,"maximum":80,"input_type":"numeric"},{"key":"chiller_temp","label":"Chiller temperature","unit":"°C","reference":"5–22 °C (41–71.6 °F)","minimum":5,"maximum":22,"input_type":"numeric"}]},{"name":"Forming","machine_types":["Forming","WaterJet / Forming"],"fields":[{"key":"oven_1","label":"Oven #1 lower","unit":"°C","reference":"350–450 °C","minimum":350,"maximum":450,"input_type":"numeric"},{"key":"oven_2","label":"Oven #2 lower","unit":"°C","reference":"350–450 °C","minimum":350,"maximum":450,"input_type":"numeric"},{"key":"heating_1","label":"Heating time · 1st","unit":"sec","reference":"50–75 sec","minimum":50,"maximum":75,"input_type":"numeric"},{"key":"heating_2","label":"Heating time · 2nd","unit":"sec","reference":"50–75 sec","minimum":50,"maximum":75,"input_type":"numeric"},{"key":"pressure","label":"Pressure","unit":"MPa","reference":"4 ± 2 MPa","minimum":2,"maximum":6,"input_type":"numeric"},{"key":"chiller_temp","label":"Chiller temperature","unit":"°C","reference":"4–21 °C (40–70 °F)","minimum":4,"maximum":21,"input_type":"numeric"},{"key":"press_time","label":"Press time","unit":"sec","reference":"40–70 sec","minimum":40,"maximum":70,"input_type":"numeric"},{"key":"cam_hyd","label":"CAM hydraulic pressure","unit":"MPa","reference":"4 ± 2 MPa","minimum":2,"maximum":6,"input_type":"numeric"}]},{"name":"Trimming","machine_types":["Press / Trim"],"fields":[{"key":"press_time","label":"Press time","unit":"sec","reference":"0.5–5 sec","minimum":0.5,"maximum":5,"input_type":"numeric"},{"key":"pressure_gauge","label":"Pressure gauge","unit":"MPa","reference":"10 ± 3 MPa","minimum":7,"maximum":13,"input_type":"numeric"}]}]$json$::jsonb) loop
  select jsonb_agg(f||jsonb_build_object('id',gen_random_uuid()::text)) into fields from jsonb_array_elements(spec->'fields') f;
  insert into public.production_parameter_templates(id,name,machine_types,fields) values(gen_random_uuid(),spec->>'name',array(select jsonb_array_elements_text(spec->'machine_types')),fields);
 end loop;
end $seed$;

