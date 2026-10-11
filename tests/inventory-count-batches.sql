
begin;
select set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
do $test$
declare raw uuid:=gen_random_uuid();wip uuid:=gen_random_uuid();ids uuid[];n integer;
begin
 insert into public.inventory_items(id,part_number,category,responsible_department) values(raw,'COUNT-RAW-'||raw,'RAW','inventory'),(wip,'COUNT-WIP-'||wip,'FG','inventory');
 ids:=public.inventory_submit_counts(jsonb_build_array(jsonb_build_object('department','inventory','area','RAW','lines',jsonb_build_array(jsonb_build_object('item_id',raw,'physical_quantity',10))),jsonb_build_object('department','inventory','area','FG','lines',jsonb_build_array(jsonb_build_object('item_id',wip,'physical_quantity',20)))));
 if cardinality(ids)<>2 then raise exception 'batch lost count areas';end if;
 begin
  perform public.inventory_submit_count('inventory','RAW',jsonb_build_array(jsonb_build_object('item_id',raw,'physical_quantity',15)));
  raise exception 'duplicate pending count accepted';
 exception when others then if sqlerrm<>'inv_count_pending' then raise;end if;end;
 begin
  perform public.inventory_review_counts(array_append(ids,gen_random_uuid()),true,'test');
  raise exception 'invalid batch accepted';
 exception when others then if sqlerrm<>'Conteo no disponible para aprobación' then raise;end if;end;
 if (select count(*) from public.inventory_counts where id=any(ids) and status='submitted')<>2 then raise exception 'failed approval partially changed counts';end if;
 perform set_config('request.jwt.claim.sub','9c45902c-ee83-4716-9f70-d8e7fe8e8b0d',true);
 begin
  perform public.inventory_review_counts(ids,true,'test');
  raise exception 'operator approved count';
 exception when others then if sqlerrm<>'Conteo no disponible para aprobación' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','270a4a29-8fe0-4eee-8267-9e797be33216',true);
 perform public.inventory_review_counts(ids,true,'test');
 if (select count(*) from public.inventory_counts where id=any(ids) and status='approved')<>2 then raise exception 'bulk approval failed';end if;
 if (select sum(quantity_delta) from public.inventory_movements where item_id=raw and area='RAW')<>10 or (select sum(quantity_delta) from public.inventory_movements where item_id=wip and area='FG')<>20 then raise exception 'bulk count adjustment incorrect';end if;
end $test$;
rollback;