import {localDate,localStart} from './live.mjs';
export function lifecycleEditor(run,runs,newId,action='reopen_batch'){
 const reopen=action==='reopen_batch';
 const siblings=runs.filter(r=>r.station_code===run.station_code&&(r.session_id||r.id)===(run.session_id||run.id)&&(reopen?r.closed_at&&r.can_reopen:!r.closed_at&&r.can_force_finish));
 return {id:newId(),action,date:localDate(),time:'',reason:'',products:siblings.map(r=>({run_id:r.id,item_id:r.item_id,closed_at:r.closed_at,started_at:r.started_at,quantity:r.latest_quantity,selected:true}))};
}
export function lifecycleSubmission(edit){
 const rows=edit.products.filter(p=>p.selected);if(!rows.length)return {error:'pl_select_finish'};
 if(edit.action==='reopen_batch'){
  const at=localStart(edit.date,edit.time);if(!at||rows.some(p=>new Date(at)<new Date(Math.floor(new Date(p.closed_at).getTime()/60000)*60000)||new Date(at)>=new Date(new Date(p.started_at).getTime()+86400000)))return {error:'pl_reopen_time_invalid'};
  return {action:edit.action,payload:{id:edit.id,reopened_at:at,products:rows.map(p=>({run_id:p.run_id,closed_at:p.closed_at}))}};
 }
 const reason=edit.reason.trim();if(reason.length<5||reason.length>2000)return {error:'pl_force_reason_invalid'};
 return {action:edit.action,payload:{id:edit.id,reason,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,products:rows.map(p=>({run_id:p.run_id}))}};
}
