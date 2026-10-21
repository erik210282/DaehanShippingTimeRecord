import {selectedDowntime,applySelectedDowntime} from './downtimeSelection.mjs';
export {affectedIds} from './downtimeSelection.mjs';
import {localDate,localStart} from './live.mjs';
import {eventsInEditor,progressCapture} from './progress.mjs';
export function activeFirst(runs=[]){return runs.map((run,index)=>({run,index})).sort((a,b)=>Number(!!a.run.closed_at)-Number(!!b.run.closed_at)||a.index-b.index).map(x=>x.run);}
export function liveEditor(run,action,runs,newId,onlyProduct=false){
 const siblings=run&&['checkpoint','finish'].includes(action)?runs.filter(r=>(r.session_id||r.id)===(run.session_id||run.id)&&!r.closed_at):[];
 return {action,started_at:run?.started_at,finish_time:'',ends_next_day:false,downtime_events:eventsInEditor(run),id:newId(),capture_group_id:newId(),run_id:run?.id||newId(),session_id:run?.session_id||newId(),station_code:run?.station_code||'',item_id:run?.item_id||'',date:run?localDate(run.started_at):localDate(),time:run?new Date(run.started_at).toTimeString().slice(0,5):'',quantity:['checkpoint','finish'].includes(action)?'':String(run?.latest_quantity??''),shift_hours:String(run?.shift_hours??''),existing:!!run,downtime_item_ids:siblings.length?siblings.map(r=>r.item_id):undefined,...(siblings.length>1?{products:siblings.map(r=>({id:newId(),run_id:r.id,item_id:r.item_id,quantity:'',selected:!onlyProduct||r.id===run.id,downtime_events:eventsInEditor(r)}))}:{})};
}
export function downtimeEditor(edit){return {...edit,downtime_events:selectedDowntime(edit)};}
export function changeProductDowntime(edit,events){return applySelectedDowntime(edit,events);}
export function liveSubmission(edit,now=new Date()){
 if(edit.action==='edit_checkpoint')return /^\d{1,12}$/.test(edit.quantity)?{action:edit.action,payload:edit}:{error:'pl_quantity_invalid'};
 const start=edit.action==='edit_run'||!edit.existing?localStart(edit.date,edit.time):undefined;
 if((edit.action==='edit_run'||!edit.existing)&&!start)return {error:'pl_start_invalid'};
 if(edit.action==='edit_run')return {action:edit.action,payload:{...edit,started_at:start}};
 const rows=edit.products?.length>1?edit.products.filter(p=>edit.action!=='finish'||p.selected!==false):[edit];
 if(!rows.length)return {error:'pl_select_finish'};
 const products=[];
 for(const row of rows){
  if(!/^\d{1,12}$/.test(row.quantity??''))return {error:'pl_quantity_invalid'};
  const merged={...edit,...row,products:undefined,started_at:edit.started_at||start,downtime_events:row.downtime_events??edit.downtime_events??[]};
  const capture=progressCapture(merged,now);if(capture.error)return capture;
  products.push({...merged,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,started_at:start,downtime_events:capture.events,...(edit.action==='finish'?{finished_at:capture.end,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}:{} )});
 }
 return edit.products?.length>1?{action:edit.action==='finish'?'finish_batch':'checkpoint_batch',payload:{products}}:{action:edit.action,payload:products[0]};
}
