-- Give the workstation catalog an explicit RAW assignment independent of outputs.
alter table public.inventory_workstations add column raw_material_ids uuid[] not null default '{}';
-- Preserve only RAW items already explicitly linked to a station. Do not infer
-- machine materials from product BOMs, ERP operations, or active production runs.
update public.inventory_workstations w set raw_material_ids=coalesce((
 select array_agg(distinct i.id order by i.id) from jsonb_array_elements(w.materials) m
 join public.inventory_items i on i.id::text=m->>'item_id' or coalesce(m->'item_ids','[]'::jsonb) ? i.id::text
 where i.category='RAW'
),'{}'::uuid[]);

create or replace function rls_internal.validate_workstation_raw_materials()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(new.raw_material_ids) raw_id left join public.inventory_items i on i.id=raw_id where i.id is null or i.category<>'RAW')
 or cardinality(new.raw_material_ids)<>(select count(distinct raw_id) from unnest(new.raw_material_ids) raw_id)
 then raise exception 'dt_raw_invalid';end if;
 return new;
end $$;
revoke all on function rls_internal.validate_workstation_raw_materials() from public,anon,authenticated;
create trigger validate_workstation_raw_materials before insert or update of raw_material_ids on public.inventory_workstations for each row execute function rls_internal.validate_workstation_raw_materials();

create or replace function rls_internal.production_station_raw_ids(p_station text)
returns table(item_id uuid) language sql stable set search_path='' as $$
 select i.id from public.inventory_workstations w cross join lateral unnest(w.raw_material_ids) raw_id
 join public.inventory_items i on i.id=raw_id where w.code=p_station and w.active and i.active and i.category='RAW';
$$;
revoke all on function rls_internal.production_station_raw_ids(text) from public,anon,authenticated;
notify pgrst,'reload schema';
