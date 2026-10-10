CREATE OR REPLACE FUNCTION rls_internal.production_progress_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$begin update public.catalog_updates set version=version+1 where id=1;return null;end $function$;
REVOKE ALL ON FUNCTION rls_internal.production_progress_notify() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER production_progress_runs_changed AFTER INSERT OR UPDATE OR DELETE ON public.production_live_runs FOR EACH STATEMENT EXECUTE FUNCTION rls_internal.production_progress_notify();
CREATE TRIGGER production_progress_checkpoints_changed AFTER INSERT OR UPDATE OR DELETE ON public.production_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION rls_internal.production_progress_notify();
CREATE TRIGGER production_progress_targets_changed AFTER INSERT OR UPDATE OR DELETE ON public.production_targets FOR EACH STATEMENT EXECUTE FUNCTION rls_internal.production_progress_notify();
