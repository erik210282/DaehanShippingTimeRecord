// Export all filtered records, including every ingredient of a BOM.
export function productionExport({stations,rows,items,nameFor,status,t}) {
 const fields=stations
  ? [t('inv_station_code'),t('name'),t('inv_station_type'),t('inv_station_materials'),t('status')]
  : [t('inv_ref_fg'),t('name'),t('inv_version'),t('inv_part'),t('description'),t('inv_qty_per_fg'),t('inv_unit'),t('cat_waste'),t('status'),t('inv_notes'),t('pr_packing_type'),t('pr_basis'),t('pr_pieces_per_box'),t('pr_box_name')];
 const data=stations ? rows.map(r=>[
  r.code,r.name,r.machine_type,(r.materials||[]).map(m=>[m.erp_material,m.product||m.operation].filter(Boolean).join(' · ')).join(' / '),t(r.active?'active':'inactive')
 ]) : rows.flatMap(r=>{
  const lines=r.inventory_bom_lines?.length?r.inventory_bom_lines:[{}];
  return [...lines.map(l=>{
   const item=items.find(i=>i.id===l.ingredient_id);
   return [r.product_part_number,nameFor(r),r.version||'',item?.part_number||'',item?.part_name||item?.description||'',l.quantity_per_unit??'',item?.uom||'',l.waste_rate==null?'':Number(l.waste_rate)*100,t(status(r)),r.notes||'','',t('pr_per_piece'),'',''];
  }),...(r.inventory_bom_packaging_lines||[]).map(l=>{
   const item=items.find(i=>i.id===l.ingredient_id),profile=r.inventory_bom_packaging.find(p=>p.packaging_type===l.packaging_type);
   return [r.product_part_number,nameFor(r),r.version||'',item?.part_number||'',item?.part_name||item?.description||'',l.quantity,item?.uom||'',Number(l.waste_rate)*100,t(status(r)),r.notes||'',profile?.box_name||'',t('pr_per_'+l.basis),profile?.pieces_per_box||'',profile?.box_name||''];
  })];
 });
 return {fields,data};
}
