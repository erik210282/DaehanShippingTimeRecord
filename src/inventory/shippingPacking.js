import {useCallback,useEffect,useRef,useState} from 'react';

export function blankAllocation(boxes='') {return {boxes:String(boxes),option_id:'',material_id:''};}
export function allocationsFor(line,draft) {
 return draft[line.id] || line.allocations || [blankAllocation(line.cantidad_cajas)];
}
export function packingTotal(rows) {return rows.reduce((total,row)=>total+Number(row.boxes||0)*Number(row.pieces_per_box||0),0);}
export function packingWeight(row){
 const boxes=Number(row.boxes),capacity=Number(row.pieces_per_box);
 let empty=boxes*Number(row.box_weight||0);
 if(row.assembly_version>=2&&row.weight_complete&&row.components?.length){
  empty=row.components.reduce((sum,c)=>sum+Number(c.weight_lb||0)*Number(c.quantity)*
   (c.basis==='piece'?boxes*capacity:c.basis==='pallet'?Math.ceil(boxes/Number(row.boxes_per_pallet)):boxes),0);
 }
 const total=boxes*capacity*Number(row.piece_weight||0)+empty;
 return {total,perPackage:total/boxes};
}
export function packingValid(line,rows) {
 return rows.length>0 && rows.every(row=>Number.isInteger(Number(row.boxes))&&Number(row.boxes)>0 &&
 line.options.some(o=>o.option_id===row.option_id&&o.materials.some(m=>m.id===row.material_id))) &&
 rows.reduce((sum,row)=>sum+Number(row.boxes),0)===Number(line.cantidad_cajas);
}
export function resolvePacking(line,rows) {
 return rows.map(row=>{
  // Saved allocations are immutable snapshots unless explicitly edited.
  if(row.pieces_per_box!=null) return row;
  const option=line.options.find(o=>o.option_id===row.option_id);
  const material=option?.materials.find(m=>m.id===row.material_id);
  return {...row,pieces_per_box:line.historical?(line.dispatch_capacity||option?.pieces_per_box):option?.pieces_per_box,packing_type:material?.packing_type,package_label:material?.package_label,
   material_part_number:material?.part_number,dimensions:material?.dimensions,
   piece_weight:Number(line.product.peso_por_pieza||0),box_weight:Number(material?.box_weight||0)};
 });
}
export function optionLabel(option,t) {
 const kinds=[...new Set(option.materials.map(m=>m.packing_type))].map(k=>t('rc_'+k)).join('/');
 return kinds+' | '+option.pieces_per_box+' '+t('inv_pieces_per_box')+' | '+option.materials.map(m=>m.part_number).join(' + ');
}
export function normalizePackingContext(context){
 if(!context||context.confirmed)return context;
 return {...context,lines:context.lines.map(line=>({...line,allocations:line.allocations?.map(row=>{
  if(row.assembly_version>=2||row.legacy)return row;
  const option=line.options.find(o=>o.option_id===row.option_id||o.source_option_ids?.includes(row.option_id));
  return option?{boxes:row.boxes,option_id:option.option_id,material_id:option.materials[0].id}:row;
 })}))};
}
export function packingError(error,t) {
 const key=String(error?.message||error).match(/sp_[a-z_]+/)?.[0];
 return key?t(key):String(error?.message||error);
}
export function useShippingPacking(client,idx) {
 const [context,setContext]=useState(null),[draft,setDraft]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(null);
 const epoch=useRef(0);
 const reload=useCallback(async()=>{
  const token=++epoch.current;setContext(null);setDraft({});setError(null);
  if(!idx){setLoading(false);return;}
  setLoading(true);
  try {const {data,error:failure}=await client.rpc('shipping_packing_context',{p_idx:idx});if(failure)throw failure;
   if(token===epoch.current)setContext(normalizePackingContext(data));
  }catch(failure){if(token===epoch.current)setError(failure);}
  finally{if(token===epoch.current)setLoading(false);}
 },[client,idx]);
 useEffect(()=>{reload();return()=>{epoch.current++;};},[reload]);
 const change=(line,index,patch)=>setDraft(previous=>{
  const rows=allocationsFor(line,previous).map((row,i)=>i===index?{boxes:row.boxes,option_id:row.option_id,material_id:row.material_id,...patch}:row);
  return {...previous,[line.id]:rows};
 });
 const add=line=>setDraft(previous=>({...previous,[line.id]:[...allocationsFor(line,previous),blankAllocation()]}));
 const remove=(line,index)=>setDraft(previous=>({...previous,[line.id]:allocationsFor(line,previous).filter((_,i)=>i!==index)}));
 const valid=!!context?.lines.length && context.lines.every(line=>{
  // An existing snapshot can still be used after its BOM was archived.
  if(!draft[line.id]&&line.allocations?.every(row=>row.pieces_per_box!=null))return line.allocations.reduce((sum,a)=>sum+Number(a.boxes),0)===Number(line.cantidad_cajas);
  return packingValid(line,allocationsFor(line,draft));
 });
 async function save(){
  if(!valid)throw Error('sp_required');
  if(context.confirmed)return context;
  const token=epoch.current;
  const {data,error:failure}=await client.rpc('shipping_save_packing',{p_idx:idx,p_lines:context.lines.map(line=>({line_id:line.id,saved_at:line.saved_at,
   allocations:resolvePacking(line,allocationsFor(line,draft)).map(({boxes,option_id,material_id,pieces_per_box,dimensions})=>({boxes:Number(boxes),option_id,material_id,expected_capacity:pieces_per_box,expected_dimensions:dimensions}))}))});
  if(failure)throw failure;
  if(token!==epoch.current)throw Error('sp_stale');
  setContext(data);setDraft({});return data;
 }
 return {context,draft,loading,error,reload,valid,change,add,remove,save};
}
