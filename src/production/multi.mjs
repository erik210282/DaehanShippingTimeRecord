import {dailySignature} from './dailyDetails.mjs';

const productFields=['id','live_run_id','item_id','machine_quantity','scrap_quantity','rework_quantity','packaging_type','full_boxes','pallets','pieces_per_box','note','rework_completed','catalog_packing','downtime_events','packing_breakdown','break_work','production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode'];
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
export function dailyMachineKey(row,runs=[]){const run=runs.find(r=>r.id===row.live_run_id);return row.machine_session_id||run?.session_id||row.shift_session_id||row.capture_group_id||row.id;}
export function openCapture(row,reports,runs=[]){const key=dailyMachineKey(row,runs);const siblings=reports.filter(r=>r.status==='draft'&&(r.id===row.id||!r.live_run_id||runs.find(run=>run.id===r.live_run_id)?.closed_at||!runs.length)&&r.station_code===row.station_code&&r.production_date===row.production_date&&dailyMachineKey(r,runs)===key);return {...row,group_id:row.capture_group_id||key,machine_session_id:key,start_time:String(row.start_time||'').slice(0,5),end_time:String(row.end_time||'').slice(0,5),products:(siblings.length?siblings:[row]).map(r=>pick({...r,start_time:String(r.start_time||'').slice(0,5),end_time:String(r.end_time||'').slice(0,5)}))};}
export function changeDailyShared(edit,patch){const common=['production_date','start_time','end_time','ends_next_day','people','staff_names','turns','report_mode','break_work'];const shared=Object.fromEntries(Object.entries(patch).filter(([key])=>common.includes(key)));return {...edit,...patch,products:edit.products?.map(row=>({...row,...shared}))};}
export function dailyMissing(edit,reports,runs,configured=[]){const selected=new Set(dailyProducts(edit).map(r=>r.item_id)),key=edit.machine_session_id||dailyMachineKey(edit,runs);const siblings=runs.filter(r=>r.station_code===edit.station_code&&(r.session_id||r.id)===key);const ids=[...new Set([...configured,...siblings.map(r=>r.item_id)])];return ids.filter(id=>!selected.has(id)&&!reports.some(r=>r.station_code===edit.station_code&&r.production_date===edit.production_date&&r.item_id===id&&r.status!=='draft'&&dailyMachineKey(r,runs)===key)).map(item_id=>({item_id,run:siblings.find(r=>r.item_id===item_id),selected:true}));}
export function addDailyMissing(edit,choices,reports,newId){let next=edit;for(const choice of choices.filter(p=>p.selected)){const run=choice.run,saved=reports.find(r=>r.live_run_id===run?.id&&run?.id&&r.status==='draft');const row=saved?pick(saved):pick({...edit,id:newId(),live_run_id:run?.id||null,item_id:choice.item_id,machine_quantity:run?.latest_at?String(run.latest_quantity):'',scrap_quantity:'',rework_quantity:'',full_boxes:'',packaging_type:'',packing_breakdown:[],pallets:'0',downtime_events:run?.downtime_events?.map(e=>({...e,start_time:new Date(e.start_at).toTimeString().slice(0,5),end_time:new Date(e.end_at).toTimeString().slice(0,5),minutes:(new Date(e.end_at)-new Date(e.start_at))/60000}))||[]});next={...next,products:[...dailyProducts(next).map(pick),row]};}return next;}
export function sharedTimeRows(rows){
 const seen=new Set();
 return rows.filter(r=>{const key=(r.machine_session_id||r.capture_group_id||r.id)+'|'+dailySignature(r);if(seen.has(key))return false;seen.add(key);return true;});
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
 en:{pm_products:'Products',pm_shared_hint:'The machine, shift and staff are shared. Capture downtime and quantities separately for each product.',pm_quantity_for:'Produced quantity · {{part}}'},
 es:{pm_products:'Productos',pm_shared_hint:'La máquina, el horario y el personal se comparten. Los paros y las cantidades se capturan por producto.',pm_quantity_for:'Cantidad producida · {{part}}'},
 ko:{pm_products:'제품',pm_shared_hint:'기계, 근무 시간, 인원은 공유됩니다. 정지 시간과 수량은 제품별로 입력하세요.',pm_quantity_for:'생산 수량 · {{part}}'}
 };
 for(const [lang,values] of Object.entries(resources))i18n.addResourceBundle(lang,'translation',values,true,true);
}
