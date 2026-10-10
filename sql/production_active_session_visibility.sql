CREATE OR REPLACE FUNCTION rls_internal.production_live_snapshot_range(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare manager boolean;
begin
 if auth.uid() is null or not public.inventory_access('production') then raise exception 'pr_forbidden';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '48 hours' then raise exception 'pr_invalid';end if;
 manager:=public.inventory_access('production',true);
 return jsonb_build_object('server_now',now(),'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.production_targets t where deleted_at is null),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from
 (select r.*,(manager or r.created_by=auth.uid()) as can_manage,c.expected_quantity,c.attainment,c.performance,c.quantity as period_quantity,c.recorded_at as period_at,false as overdue
 from public.production_live_runs r left join lateral(select c.* from public.production_checkpoints c where c.run_id=r.id and c.deleted_at is null and c.recorded_at<p_to order by c.recorded_at desc,c.id desc limit 1)c on true
 where r.deleted_at is null and(manager or r.created_by=auth.uid() or r.closed_at is null) and
 (exists(select 1 from public.production_checkpoints pc where pc.run_id=r.id and pc.deleted_at is null and pc.recorded_at>=p_from and pc.recorded_at<p_to)
 or(r.started_at<p_to and coalesce(r.closed_at,now())>=p_from)))x),'[]'::jsonb),
 'checkpoints',coalesce((select jsonb_agg(to_jsonb(c) order by c.recorded_at desc,c.id desc) from public.production_checkpoints c join public.production_live_runs r on r.id=c.run_id where c.deleted_at is null and r.deleted_at is null and(manager or r.created_by=auth.uid()) and c.recorded_at>=p_from and c.recorded_at<p_to),'[]'::jsonb));
end $function$
