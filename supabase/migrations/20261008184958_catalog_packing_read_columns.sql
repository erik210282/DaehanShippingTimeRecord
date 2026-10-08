grant select (packing_weight,packing_measures) on public.inventory_items to authenticated;
notify pgrst,'reload schema';
