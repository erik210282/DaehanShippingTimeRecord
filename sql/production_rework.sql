alter table public.inventory_quality_holds add column released_quantity numeric not null default 0;
alter table public.inventory_quality_holds add column rejected_quantity numeric not null default 0;
alter table public.inventory_quality_holds add column version integer not null default 1;
update public.inventory_quality_holds set released_quantity=quantity where status='released';
update public.inventory_quality_holds set rejected_quantity=quantity where status='rejected';
alter table public.inventory_quality_holds add constraint quality_disposition_quantities check(released_quantity>=0 and rejected_quantity>=0 and released_quantity+rejected_quantity<=quantity);
alter table public.inventory_quality_holds drop constraint inventory_quality_holds_status_check;
alter table public.inventory_quality_holds add constraint inventory_quality_holds_status_check check(status in ('held','released','rejected','resolved'));
create table public.production_rework_reports(
 id uuid primary key,hold_id uuid not null references public.inventory_quality_holds(id),
 good_quantity numeric not null check(good_quantity>=0),scrap_quantity numeric not null check(scrap_quantity>=0),
 recorded_at timestamptz not null,timezone text not null,note text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_by uuid not null references auth.users(id),reporter_name text not null,created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),reviewer_name text,reviewed_at timestamptz,review_note text not null default '',
 payload jsonb not null,check(good_quantity+scrap_quantity>0));
create index production_rework_reports_hold_status on public.production_rework_reports(hold_id,status);
alter table public.production_rework_reports enable row level security;
revoke all on public.production_rework_reports from public,anon,authenticated;
grant select on public.production_rework_reports to authenticated;
create policy rework_reports_read on public.production_rework_reports for select to authenticated using((select public.inventory_access('production')) or (select public.inventory_access('quality')));
create trigger rework_changed after insert or update or delete on public.production_rework_reports for each statement execute function rls_internal.notify_catalog_update();
create trigger quality_holds_changed after insert or update or delete on public.inventory_quality_holds for each statement execute function rls_internal.notify_catalog_update();
insert into public.global_role_activity_catalog(department,activity,allowed_roles,default_roles) values('production','rework',array['operador','lider','supervisor'],array['operador','lider','supervisor']);
update public.global_role_access_profiles set activities=array_append(activities,'rework') where department='production' and version=1 and not 'rework'=any(activities);

create or replace function rls_internal.production_rework_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request uuid:=(p_data->>'id')::uuid;report public.production_rework_reports;hold public.inventory_quality_holds;
 good numeric;scrap numeric;reserved numeric;remaining numeric;person text;at_time timestamptz;zone text;
begin
 if auth.uid() is null or not public.inventory_access() then raise exception 'ra_denied';end if;
 if request is null then raise exception 'rw_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('rework:'||request,0));
 if p_action='report' then
  if not public.inventory_access('production') or not rls_internal.role_activity_access('production','rework') then raise exception 'ra_denied';end if;
  select * into report from public.production_rework_reports where id=request;
  if report.id is not null then
   if report.created_by<>auth.uid() or report.payload<>p_data then raise exception 'rw_invalid';end if;
   return jsonb_build_object('saved',true);
  end if;
  select * into hold from public.inventory_quality_holds where id=(p_data->>'hold_id')::uuid for update;
  if hold.id is null or hold.status<>'held' or hold.source_area not in ('FG','WIP') or not exists(select 1 from public.inventory_items where id=hold.item_id and category in ('FG','SEMI')) then raise exception 'rw_unavailable';end if;
  good:=nullif(p_data->>'good_quantity','')::numeric;scrap:=nullif(p_data->>'scrap_quantity','')::numeric;
  if good is null or scrap is null or good<0 or scrap<0 or good+scrap<=0 or good::text in ('NaN','Infinity','-Infinity') or scrap::text in ('NaN','Infinity','-Infinity') or length(coalesce(p_data->>'note',''))>2000 then raise exception 'rw_invalid';end if;
  select coalesce(sum(good_quantity+scrap_quantity),0) into reserved from public.production_rework_reports where hold_id=hold.id and status='pending';
  remaining:=hold.quantity-hold.released_quantity-hold.rejected_quantity-reserved;
  if good+scrap>remaining then raise exception 'rw_exceeds';end if;
  at_time:=nullif(p_data->>'recorded_at','')::timestamptz;zone:=p_data->>'timezone';
  if at_time is null or at_time>clock_timestamp()+interval '1 minute' or zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'pr_time_invalid';end if;
  select nombre into person from public.operadores where uid=auth.uid() limit 1;
  if nullif(trim(person),'') is null then raise exception 'pp_leader_missing';end if;
  insert into public.production_rework_reports(id,hold_id,good_quantity,scrap_quantity,recorded_at,timezone,note,created_by,reporter_name,payload)
   values(request,hold.id,good,scrap,at_time,zone,coalesce(p_data->>'note',''),auth.uid(),person,p_data);
 elsif p_action in ('approve','reject') then
  if not public.inventory_access('quality',true) or not rls_internal.role_activity_access('quality','quality') then raise exception 'ra_denied';end if;
  select * into report from public.production_rework_reports where id=request;
  if report.id is null then raise exception 'rw_unavailable';end if;
  -- Lock the hold before the report, matching report creation and legacy resolution.
  select * into hold from public.inventory_quality_holds where id=report.hold_id for update;
  select * into report from public.production_rework_reports where id=request for update;
  if report.status=(case when p_action='approve' then 'approved' else 'rejected' end) then return jsonb_build_object('saved',true);end if;
  if report.status<>'pending' or hold.status<>'held' then raise exception 'rw_unavailable';end if;
  if length(coalesce(p_data->>'note',''))>2000 or p_action='reject' and nullif(trim(p_data->>'note'),'') is null then raise exception 'rw_note_required';end if;
  if p_action='approve' then
   good:=report.good_quantity;scrap:=report.scrap_quantity;
   if good+scrap>hold.quantity-hold.released_quantity-hold.rejected_quantity then raise exception 'rw_exceeds';end if;
   if good>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by) values
     (hold.item_id,'HOLD',-good,'QUALITY_RELEASE','rework-good-out:'||request,report.note,hold.lot,auth.uid()),
     (hold.item_id,hold.source_area,good,'QUALITY_RELEASE','rework-good-in:'||request,report.note,hold.lot,auth.uid());
   end if;
   if scrap>0 then
    insert into public.inventory_movements(item_id,area,quantity_delta,kind,reference_key,note,lot,created_by) values
     (hold.item_id,'HOLD',-scrap,'QUALITY_REJECT','rework-scrap:'||request,report.note,hold.lot,auth.uid());
   end if;
   update public.inventory_quality_holds set released_quantity=released_quantity+good,rejected_quantity=rejected_quantity+scrap,
    status=case when released_quantity+rejected_quantity+good+scrap<quantity then 'held' when rejected_quantity+scrap=0 then 'released' when released_quantity+good=0 then 'rejected' else 'resolved' end,
    version=version+1,reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_data->>'note','') where id=hold.id;
  end if;
  select nombre into person from public.operadores where uid=auth.uid() limit 1;
  update public.production_rework_reports set status=case when p_action='approve' then 'approved' else 'rejected' end,
   reviewed_by=auth.uid(),reviewer_name=person,reviewed_at=now(),review_note=coalesce(p_data->>'note','') where id=request;
 else raise exception 'rw_invalid';end if;
 return jsonb_build_object('saved',true);
end $$;
create or replace function public.production_rework_action(p_action text,p_data jsonb)
returns jsonb language sql set search_path='' as $$select rls_internal.production_rework_action(p_action,p_data)$$;
revoke all on function public.production_rework_action(text,jsonb),rls_internal.production_rework_action(text,jsonb) from public,anon;
grant execute on function public.production_rework_action(text,jsonb),rls_internal.production_rework_action(text,jsonb) to authenticated;

create or replace function rls_internal.production_rework_snapshot()
returns jsonb language plpgsql security definer set search_path='' as $$
declare holds jsonb;reports jsonb;
begin
 if not (public.inventory_access('production') and rls_internal.role_activity_access('production','rework') or public.inventory_access('quality') and rls_internal.role_activity_access('quality','quality')) then raise exception 'ra_denied';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into holds from (
  select h.*,i.part_number,coalesce(p.nombre,i.part_name,i.description,'') as part_name,i.uom,
   h.quantity-h.released_quantity-h.rejected_quantity as remaining_quantity,
   coalesce((select sum(r.good_quantity+r.scrap_quantity) from public.production_rework_reports r where r.hold_id=h.id and r.status='pending'),0) as pending_quantity
  from public.inventory_quality_holds h join public.inventory_items i on i.id=h.item_id left join public.productos p on p.id=i.producto_id
  where h.source_area in ('FG','WIP') and i.category in ('FG','SEMI') and (h.status='held' or h.reviewed_at>now()-interval '90 days')
 )x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into reports from (
  select r.*,h.item_id,h.source_area,h.lot,h.reason,i.part_number,coalesce(p.nombre,i.part_name,i.description,'') as part_name,i.uom
  from public.production_rework_reports r join public.inventory_quality_holds h on h.id=r.hold_id join public.inventory_items i on i.id=h.item_id left join public.productos p on p.id=i.producto_id
  where r.status='pending' or r.id in(select id from public.production_rework_reports where status<>'pending' order by created_at desc limit 500)
  order by r.created_at desc
 )x;
 return jsonb_build_object('holds',holds,'reports',reports);
end $$;
create or replace function public.production_rework_snapshot()
returns jsonb language sql set search_path='' as $$select rls_internal.production_rework_snapshot()$$;
revoke all on function public.production_rework_snapshot(),rls_internal.production_rework_snapshot() from public,anon;
grant execute on function public.production_rework_snapshot(),rls_internal.production_rework_snapshot() to authenticated;
