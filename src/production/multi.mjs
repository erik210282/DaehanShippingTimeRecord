
const productFields=['id','item_id','machine_quantity','scrap_quantity','rework_quantity','packaging_type','full_boxes','pallets','pieces_per_box','note','rework_completed','catalog_packing'];
const pick=r=>Object.fromEntries(productFields.map(k=>[k,r[k]]));
export function dailyProducts(edit){
 const rows=Array.isArray(edit.products)?edit.products:edit.item_id?[pick(edit)]:[];
 return rows.map(row=>({...edit,...row,...(row.item_id===edit.item_id?pick(edit):{}),products:undefined}));
}
export function selectProducts(edit,ids,newId){
 const saved=dailyProducts(edit);
 const products=ids.map(item_id=>pick(saved.find(r=>r.item_id===item_id)||{...edit,id:!saved.length&&item_id===ids[0]?edit.id:newId(),item_id,machine_quantity:'',scrap_quantity:'',rework_quantity:'',packaging_type:'',full_boxes:'',pallets:'0',pieces_per_box:0,note:''}));
 const current=products.find(r=>r.item_id===edit.item_id)||products[0];
 return {...edit,...(current||{item_id:''}),products};
}
export function switchProduct(edit,itemId){
 const products=dailyProducts(edit).map(pick);
 return {...edit,...products.find(r=>r.item_id===itemId),products};
}
export function openCapture(row,reports){
 const siblings=row.capture_group_id?reports.filter(r=>r.capture_group_id===row.capture_group_id&&r.status==='draft'):[row];
 return {...row,start_time:String(row.start_time||'').slice(0,5),end_time:String(row.end_time||'').slice(0,5),products:siblings.map(pick)};
}
export function sharedTimeRows(rows){
 const seen=new Set();
 return rows.filter(r=>{const key=r.capture_group_id||r.id;if(seen.has(key))return false;seen.add(key);return true;});
}
const savedSingle=edit=>!edit.products||edit.products.length<=1;
export function selectLiveProducts(edit,ids,newId){
 const saved=(edit.products||[{item_id:edit.item_id,id:edit.id,run_id:edit.run_id,quantity:edit.quantity}]).map(row=>savedSingle(edit)&&row.item_id===edit.item_id?{...row,quantity:edit.quantity}:row);
 const products=[...new Set(ids)].map(item_id=>saved.find(r=>r.item_id===item_id)||{item_id,id:newId(),run_id:newId(),quantity:''});
 const current=products.find(row=>row.item_id===edit.item_id)||products[0];
 return {...edit,products,item_id:current?.item_id||'',quantity:current?.quantity??''};
}

export function registerMulti(i18n){
 const resources={
 en:{pm_products:'Products',pm_shared_hint:'The machine, shift, staff and downtime are shared. Enter quantities and packing for each selected product.',pm_quantity_for:'Produced quantity · {{part}}'},
 es:{pm_products:'Productos',pm_shared_hint:'La máquina, el horario, el personal y los paros se comparten. Captura las cantidades y el empaque de cada producto seleccionado.',pm_quantity_for:'Cantidad producida · {{part}}'},
 ko:{pm_products:'제품',pm_shared_hint:'기계, 근무 시간, 작업자 및 중단 시간을 공유합니다. 선택한 제품별 수량과 포장을 입력하세요.',pm_quantity_for:'생산 수량 · {{part}}'}
 };
 for(const [lang,values] of Object.entries(resources))i18n.addResourceBundle(lang,'translation',values,true,true);
}
