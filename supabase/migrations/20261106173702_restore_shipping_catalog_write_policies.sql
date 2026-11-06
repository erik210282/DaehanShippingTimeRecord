-- These two legacy catalogs are edited directly by Catalogos and CatalogsMobile.
-- Keep their existing SELECT policies for shipping consumers; authorize writes
-- with the same active Catalogs membership check used by shared_catalog.
create policy catalogo_pos_manage_insert on public.catalogo_pos
for insert to authenticated with check ((select rls_internal.catalog_access(true)));
create policy catalogo_pos_manage_update on public.catalogo_pos
for update to authenticated using ((select rls_internal.catalog_access(true)))
with check ((select rls_internal.catalog_access(true)));
create policy catalogo_pos_manage_delete on public.catalogo_pos
for delete to authenticated using ((select rls_internal.catalog_access(true)));

create policy catalogo_shipper_manage_insert on public.catalogo_shipper
for insert to authenticated with check ((select rls_internal.catalog_access(true)));
create policy catalogo_shipper_manage_update on public.catalogo_shipper
for update to authenticated using ((select rls_internal.catalog_access(true)))
with check ((select rls_internal.catalog_access(true)));
create policy catalogo_shipper_manage_delete on public.catalogo_shipper
for delete to authenticated using ((select rls_internal.catalog_access(true)));
