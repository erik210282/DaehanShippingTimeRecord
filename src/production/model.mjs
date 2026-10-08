
export const blankIngredient=()=>({ingredient_id:'',quantity_per_unit:'',waste:'0'});
export const blankPackingLine=()=>({ingredient_id:'',quantity:'',basis:'box',waste:'0'});
export function recipePacking(bom,products=[]) {
 const product=products.find(p=>p.part_number===bom.product_part_number);
 return ['returnable','expendable'].map(type=>{
  const profile=bom.inventory_bom_packaging?.find(p=>p.packaging_type===type);
  return {packaging_type:type,enabled:!!profile,boxes_per_pallet:profile?.boxes_per_pallet??'',pieces_per_box:product?.[type==='returnable'?'cantidad_por_caja_retornable':'cantidad_por_caja_expendable']??profile?.pieces_per_box??'',box_name:product?.[type==='returnable'?'tipo_empaque_retornable':'tipo_empaque_expendable']||profile?.box_name||'',lines:profile?(bom.inventory_bom_packaging_lines||[]).filter(l=>l.packaging_type===type).map(l=>({...l,waste:String(Number(l.waste_rate)*100)})):[]};
 });
}
export function isRepack(bom,itemId) {return !!itemId&&bom?.inventory_bom_lines?.length===1&&bom.inventory_bom_lines[0].ingredient_id===itemId;}
export function isTurntable(station) {return /turn\s?table|t\/t/i.test(station?.name||'');}

export const downtimeTypes=['break','lunch','maintenance','breakdown'];
export const blankDowntime=()=>({type:'break',minutes:'',note:''});
export function reportDowntimes(r,{forEdit=false}={}) {
 if(Array.isArray(r.downtime_events))return r.downtime_events.map(x=>({...x,minutes:String(x.minutes)}));
 const rows=[];
 if(Number(r.break_minutes)>0)rows.push({type:'break',minutes:String(r.break_minutes),note:''});
 if(Number(r.downtime_minutes)>0)rows.push({type:forEdit?'':'legacy',minutes:String(r.downtime_minutes),note:r.downtime_reason||''});
 return rows;
}
export function automaticPallets(r,bom,profile) {
 if(!Number(r.full_boxes)||!bom?.inventory_bom_packaging_lines?.some(l=>l.packaging_type===r.packaging_type&&l.basis==='pallet'))return 0;
 const capacity=Number(profile?.boxes_per_pallet);
 return Number.isInteger(capacity)&&capacity>0?Math.ceil(Number(r.full_boxes)/capacity):null;
}
export function prepareReport(r,bom,profile) {
 if(!Array.isArray(r.downtime_events))return r;
 const m=reportMetrics(r,profile),breaks=r.downtime_events.filter(d=>['break','lunch'].includes(d.type));
 return {...r,machine_minutes:m.machine,downtime_minutes:m.totalDowntime-m.breaks,break_count:breaks.length,break_minutes:m.breaks,downtime_reason:r.downtime_events.filter(d=>!['break','lunch'].includes(d.type)).map(d=>d.type+(d.note?': '+d.note:'')).join('; '),pallets:automaticPallets(r,bom,profile)};
}

export function reportMetrics(r,profile) {
 const clock=s=>{const [h,m]=String(s||'').split(':').map(Number);return h*60+m;};
 const elapsed=clock(r.end_time)-clock(r.start_time)+(r.ends_next_day?1440:0);
 const good=Number(r.machine_quantity||0)-Number(r.scrap_quantity||0)+(r.rework_completed===true?1:-1)*Number(r.rework_quantity||0);
 const packed=Number(r.full_boxes||0)*Number(profile?.pieces_per_box??r.pieces_per_box??0);
 const automatic=Array.isArray(r.downtime_events);
 const totalDowntime=automatic?r.downtime_events.reduce((sum,d)=>sum+Number(d.minutes),0):Number(r.downtime_minutes||0)+Number(r.break_minutes||0);
 const breaks=automatic?r.downtime_events.filter(d=>['break','lunch'].includes(d.type)).reduce((sum,d)=>sum+Number(d.minutes),0):Number(r.break_minutes||0);
 const worked=elapsed-breaks,machine=automatic?elapsed-totalDowntime:Number(r.machine_minutes||0);
 return {elapsed,good,packed,wip:Math.max(0,good-packed),worked,machine,totalDowntime,breaks,laborHours:worked*Number(r.people||0)/60,idle:automatic?0:worked-(totalDowntime-breaks)-machine};
}
export function validateReport(r,{station,bom,profile,forSubmit=true}={}) {
 if(Array.isArray(r.downtime_events)){
  if(r.downtime_events.length>1000||r.downtime_events.some(d=>!downtimeTypes.includes(d.type)||d.minutes===''||!Number.isFinite(Number(d.minutes))||Number(d.minutes)<=0))return 'pr_downtime_invalid';
  r=prepareReport(r,bom,profile);
  if(r.pallets===null)return 'pr_pallet_capacity';
 }
 const m=reportMetrics(r,profile);
 if(!station?.active)return 'pr_station_required';
 if(!r.item_id)return 'pr_item_required';
 const numbers=['machine_minutes','downtime_minutes','break_minutes','break_count','people','machine_quantity','scrap_quantity','rework_quantity','full_boxes','pallets'];
 if(numbers.some(key=>r[key]===''||r[key]==null||!Number.isFinite(Number(r[key]))||Number(r[key])<0))return 'pr_invalid';
 if(!Number.isFinite(m.elapsed)||m.elapsed<=0||m.elapsed>1440||Number(r.people)<1||m.idle<0||
   (Number(r.break_count)===0)!==(Number(r.break_minutes)===0)||
   (Number(r.downtime_minutes)>0&&!r.downtime_reason?.trim()))return 'pr_time_invalid';
 if(['break_count','people','machine_quantity','scrap_quantity','rework_quantity','full_boxes','pallets'].some(key=>!Number.isInteger(Number(r[key])))||Number(r.scrap_quantity)>Number(r.machine_quantity)||m.good<0||m.packed>m.good)return 'pr_quantity_invalid';
 if(isTurntable(station)&&(r.turns===''||r.turns==null||!Number.isInteger(Number(r.turns))||Number(r.turns)<0))return 'pr_turns_required';
 if(Number(r.full_boxes)>0&&!profile)return 'pr_pack_missing';
 if(Number(r.full_boxes)===0&&Number(r.pallets)!==0)return 'pr_quantity_invalid';
 if(Number(r.full_boxes)>0&&bom?.inventory_bom_packaging_lines?.some(l=>l.packaging_type===r.packaging_type&&l.basis==='pallet')&&Number(r.pallets)<=0)return 'pr_pallets_required';
 if(forSubmit&&r.report_mode==='packing'&&(isRepack(bom,r.item_id)||Number(r.scrap_quantity)!==0||Number(r.rework_quantity)!==0||m.good!==m.packed||m.packed<=0))return 'pr_packing_only_invalid';
 if(forSubmit&&isRepack(bom,r.item_id)&&(m.good!==m.packed||Number(r.rework_quantity)!==0))return 'pr_repack_boxes';
 return null;
}
export function consumptionPreview(r,bom,items,profile) {
 r=prepareReport(r,bom,profile);
 const metrics=reportMetrics(r,profile),self=isRepack(bom,r.item_id),total=Number(r.machine_quantity||0),map=new Map();
 const add=(id,area,source,quantity)=>{
  if(!(quantity>0))return;const key=id+':'+area+':'+source;
  map.set(key,{ingredient_id:id,area,source,quantity:(map.get(key)?.quantity||0)+quantity});
 };
 if(r.report_mode==='packing')add(r.item_id,'WIP','wip',metrics.packed);
 else if(self)add(r.item_id,'FG','repack',total);
 else for(const l of bom?.inventory_bom_lines||[]){
  const item=items.find(i=>i.id===l.ingredient_id);add(l.ingredient_id,item?.category==='SEMI'?'WIP':item?.category,'manufacturing',total*Number(l.quantity_per_unit)*(1+Number(l.waste_rate)));
 }
 if(metrics.packed>0)for(const l of bom?.inventory_bom_packaging_lines||[]){
  if(l.packaging_type!==r.packaging_type)continue;
  const base=l.basis==='piece'?metrics.packed:l.basis==='box'?Number(r.full_boxes):Number(r.pallets);
  add(l.ingredient_id,'PACKAGING','packing',base*Number(l.quantity)*(1+Number(l.waste_rate)));
 }
 if(metrics.packed>0&&profile?.packing_item_id&&![...map.values()].some(x=>x.ingredient_id===profile.packing_item_id))add(profile.packing_item_id,'PACKAGING','packing',Number(r.full_boxes));
 return [...map.values()];
}

export function packingProfiles(item,bom,items=[]) {
 const product=item?.productos||item;
 return ['returnable','expendable'].flatMap(type=>{
  const old=bom?.inventory_bom_packaging?.find(p=>p.packaging_type===type);
  const boxRef=product?.[type==='returnable'?'tipo_empaque_retornable':'tipo_empaque_expendable'];
  const configured=Number(product?.[type==='returnable'?'cantidad_por_caja_retornable':'cantidad_por_caja_expendable']);
  const norm=x=>String(x||'').trim().toUpperCase();
  const box=items.find(i=>i.category==='PACKAGING'&&i.active&&i.packing_type===type&&(norm(i.part_number)===norm(boxRef)||i.id===boxRef||norm(i.part_name)===norm(boxRef)));
  if(boxRef&&(!Number.isInteger(configured)||configured<=0))return [];
  if(boxRef&&!box&&!old)return [];
  if(!boxRef&&!old)return [];
  return [{...old,packaging_type:type,pieces_per_box:boxRef?configured:Number(old.pieces_per_box),box_name:box?.part_name||boxRef||old?.box_name,packing_item_id:box?.id||null}];
 });
}
