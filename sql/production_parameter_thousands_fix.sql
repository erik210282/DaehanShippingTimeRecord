-- Repair only references saved with the previous comma-as-decimal interpretation.
-- Historical readings are snapshots and remain unchanged.
with corrected as (
 select t.id,jsonb_agg(case
  when f->>'reference'='2,000-4,000 bar' and f->>'minimum'='2' and f->>'maximum'='4' then f||jsonb_build_object('minimum',2000,'maximum',4000)
  when f->>'reference'='2,000-5,000 bar' and f->>'minimum'='2' and f->>'maximum'='5' then f||jsonb_build_object('minimum',2000,'maximum',5000)
  else f end order by ordinal) fields
 from public.production_parameter_templates t cross join lateral jsonb_array_elements(t.fields) with ordinality x(f,ordinal)
 where t.deleted_at is null group by t.id
)
update public.production_parameter_templates t set fields=c.fields,version=t.version+1,updated_at=now()
from corrected c where t.id=c.id and t.fields is distinct from c.fields
returning t.name,t.version;
