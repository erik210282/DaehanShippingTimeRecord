-- Always run inside BEGIN / ROLLBACK; fixtures and ownership edits never persist.
set local role authenticated;
do $$
declare v_supplier uuid; v_raw uuid; v_packing uuid; v_fg uuid; v_token text:=gen_random_uuid()::text;
begin
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 v_supplier:=public.shared_catalog('supplier',jsonb_build_object('code','META-'||v_token,'name','Metadata supplier','street','Oak','city','Monterrey','country','Mexico'));
 v_raw:=public.shared_catalog('item',jsonb_build_object('part_number','RAW-'||v_token,'part_name','Steel coil','description','Grade A steel','material_type','RAW','uom','KG','minimum_quantity',10,'supplier_id',v_supplier,'lead_time_days',7,'responsible_department','quality'));
 if not exists(select 1 from public.inventory_items where id=v_raw and part_name='Steel coil' and description='Grade A steel' and supplier_id=v_supplier and lead_time_days=7 and responsible_department='receiving') then raise exception 'TEST: raw metadata or automatic ownership'; end if;
 perform public.shared_catalog('item',jsonb_build_object('id',v_raw,'part_number','RAW-'||v_token,'description','Updated description','material_type','RAW','uom','KG','minimum_quantity',11));
 if not exists(select 1 from public.inventory_items where id=v_raw and part_name='Steel coil' and supplier_id=v_supplier and lead_time_days=7) then raise exception 'TEST: legacy update erased metadata'; end if;
 begin
 perform public.shared_catalog('item',jsonb_build_object('id',v_raw,'part_number','RAW-'||v_token,'material_type','RAW','uom','KG','lead_time_days',2.5));raise exception 'TEST: fractional lead time allowed';
 exception when others then if sqlerrm<>'catalog_lead_time' then raise; end if; end;
 begin
 perform public.shared_catalog('item',jsonb_build_object('id',v_raw,'part_number','RAW-'||v_token,'material_type','RAW','uom','KG','supplier_id',gen_random_uuid()));raise exception 'TEST: nonexistent supplier allowed';
 exception when others then if sqlerrm<>'receiving_invalid' then raise; end if; end;
 v_packing:=public.shared_catalog('item',jsonb_build_object('part_number','PK-'||v_token,'part_name','Pallet cover','description','Packing','material_type','PACKAGING','uom','EA','responsible_department','production'));
 v_fg:=public.shared_catalog('item',jsonb_build_object('part_number','FG-'||v_token,'part_name','Finished','description','Finished product','material_type','FG','uom','EA','responsible_department','inventory','shipping',jsonb_build_object('nombre','Shipping product','peso_por_pieza',3,'cantidad_por_caja_retornable',7)));
 if (select responsible_department from public.inventory_items where id=v_packing)<>'receiving' or (select responsible_department from public.inventory_items where id=v_fg)<>'shipping' then raise exception 'TEST: category owner'; end if;
 if not exists(select 1 from public.inventory_items i join public.productos p on p.id=i.producto_id where i.id=v_fg and p.peso_por_pieza=3 and p.cantidad_por_caja_retornable=7) then raise exception 'TEST: shipping fields lost'; end if;
 if has_column_privilege('authenticated','public.inventory_items','unit_cost','SELECT') then raise exception 'TEST: cost exposed'; end if;
 if not has_column_privilege('authenticated','public.inventory_items','supplier_id','SELECT') then raise exception 'TEST: supplier unreadable'; end if;
 if has_function_privilege('anon','rls_internal.receiving_catalog(text,jsonb)','EXECUTE') then raise exception 'TEST: anonymous mutation'; end if;
end $$;
reset role;
select 'PASS: RAW part name, description, supplier, integer lead time, legacy metadata preservation, category ownership, Shipping fields and protected cost' as result;
