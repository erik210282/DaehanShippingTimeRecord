import {recordTable} from './dataExport.mjs';
// CSV projections are explicit UI fields. Never append a source row or serialize relations.
export function userCsvTable(records,defaults=[]){
 for(const row of records)for(const [key,value] of Object.entries(row)){
 if(/^Data\s*[·:]|^(?:id|.*_id|created_at|updated_at|deleted_at|created_by|updated_by|capture_group_id|request_id)$/i.test(key))throw Error('Internal CSV column: '+key);
 if(value!=null&&typeof value==='object')throw Error('CSV fields must contain user-facing scalar values');
 }
 return recordTable(records,defaults);
}
const text=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'||typeof x==='number').join(' / '):v??'';
export function dimensionsLabel(value){if(value==null)return '';if(typeof value!=='object')return String(value);return [value.length??value.l,value.width??value.w,value.height??value.h].filter(v=>v!=null).join(' × ')+(value.unit?' '+value.unit:'');}
export function catalogCsvRows({tab,kind,rows,t,suppliers=[],locations=[],billRows=[],materialLabel,supplierAddress}){
 const h=(key,fallback)=>t(key,{defaultValue:fallback}),active=r=>t((r.active??r.activo)?'active':'inactive');
 return rows.map(r=>{
 if(kind){const row={[h('rc_code','Code')]:r.code||'',[h('name','Name')]:kind==='material'?materialLabel(r,t):r.name||''};
 if(kind==='supplier')for(const [key,label] of [['street','Street'],['exterior_number','Exterior Number'],['interior_number','Interior Number'],['neighborhood','Neighborhood'],['city','City'],['state','State'],['postal_code','Postal Code'],['country','Country'],['phone','Phone']])row[h('rc_'+key,label)]=r[key]||'';
 if(kind==='location'){row[h('rc_area','Area')]=r.area||'';row[h('rc_type','Type')]=r.material_type||'';}
 if(kind==='material')row[h('rc_stock_category','Inventory Category')]=t('rc_'+r.category,{defaultValue:r.category||''});
 row[h('status','Status')]=active(r);return row;}
 if(tab==='productos'){
 const row={[h('name','Name')]:r.nombre||'',[h('part_number','Part Number')]:r.part_number||'',[h('description','Description')]:r.descripcion||'',[h('rc_type','Type')]:r.material_type||r.category||'',[h('rc_uom','Unit')]:r.uom||'',[h('inv_min_stock','Minimum Stock')]:r.minimum_quantity??'',[h('rc_allowed','Allowed Locations')]:(r.locations||[]).map(id=>{const loc=locations.find(l=>l.id===id);return loc?[loc.code,loc.name].filter(Boolean).join(' - '):'';}).filter(Boolean).join(' / '),[h('rc_preassigned_location','Preassigned Location')]:r.default_location||''};
 if(['RAW','SEMI'].includes(r.category)){const supplier=suppliers.find(s=>s.id===r.supplier_id);row[h('rc_supplier','Supplier')]=supplier?.name||'';row[h('rc_supplier_location','Supplier Location')]=supplierAddress(supplier);row[h('rc_lead_time','Lead Time')]=r.lead_time_days??'';}
 if(r.category==='FG'){for(const [key,label] of [['peso_por_pieza','Weight Per Piece'],['bin_type','Bin Type'],['tipo_empaque_retornable','Returnable Box Type'],['tipo_empaque_expendable','Expendable Box Type'],['peso_caja_retornable','Returnable Box Weight'],['peso_caja_expendable','Expendable Box Weight'],['cantidad_por_caja_retornable','Pieces Per Returnable Box'],['cantidad_por_caja_expendable','Pieces Per Expendable Box']])row[label]=text(r[key]);}
 if(r.category==='PACKAGING'){row[h('pr_packing_type','Packing Type')]=['returnable','expendable'].includes(r.packing_type)?t('rc_'+r.packing_type):'';row[h('rc_packing_weight','Weight')]=r.packing_weight??'';row[h('rc_weight_unit','Weight Unit')]=r.packing_weight_unit||'';row[h('rc_packing_measures','Dimensions')]=dimensionsLabel(r.packing_measures);}
 row[h('status','Status')]=active(r);return row;
 }
 if(tab==='pos'||tab==='shipper'){
 const prefix=tab==='pos'?'consignee':'shipper',row={};if(tab==='pos')row.PO=r.po||'';
 for(const [suffix,label] of [['name',tab==='pos'?'Consignee':'Shipper'],['address1','Address 1'],['address2','Address 2'],['city','City'],['state','State'],['zip','ZIP'],['country','Country'],['contact_name','Contact Name'],['contact_email','Contact Email'],['contact_phone','Contact Phone']])row[label]=text(r[prefix+'_'+suffix]);
 if(tab==='pos'){row.Carrier=r.carrier_name||'';row['Freight Class']=r.freight_class||'';row['Freight Charges']=r.freight_charges??'';const bill=billRows.find(b=>b.po===r.po);for(const [suffix,label] of [['name','Bill To Name'],['address1','Bill To Address 1'],['address2','Bill To Address 2'],['city','Bill To City'],['state','Bill To State'],['zip','Bill To ZIP'],['country','Bill To Country']])row[label]=bill?.['bill_to_'+suffix]||'';}
 row[h('status','Status')]=active(r);return row;
 }
 return {[h('name','Name')]:r.nombre||r.name||'',[h('status','Status')]:active(r)};
 });
}
export function countCsvRows(count,items,t){return (count.inventory_count_lines||[]).map(line=>{const item=items.find(i=>i.id===line.item_id);return {'Date':count.counted_at||count.submitted_at||'','Area':t('inv_area_'+count.area),'Department':t('inv_dept_'+count.department),'Status':t('inv_status_'+count.status),'Part Number':item?.part_number||'','Name':item?.part_name||item?.description||'','Unit':item?.uom||'','Expected Quantity':line.expected_quantity,'Physical Quantity':line.physical_quantity,'Difference':Number(line.physical_quantity)-Number(line.expected_quantity),'Notes':count.note||count.review_note||''};});}
