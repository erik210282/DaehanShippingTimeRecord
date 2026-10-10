import {localDate,localStart,dayRange} from './live.mjs';
import {downtimeSchedule} from './capture.mjs';

export const effectiveShiftHours=hours=>Number(hours)===10?9.3:7.5;
export function uphTarget(target){return Number(target.target_8h||0)/7.5;}
export function synchronizedTargets(target,key,value){
 const n=Number(value),uph=key==='target_10h'?n/9.3:n/7.5;
 return {...target,[key]:value,...(Number.isFinite(uph)&&uph>0?{[key==='target_10h'?'target_8h':'target_10h']:String(Number((uph*(key==='target_10h'?7.5:9.3)).toFixed(4)))}:{})};
}
export function eventsInEditor(run){return (run?.downtime_events||[]).map(d=>({...d,start_time:new Date(d.start_at).toTimeString().slice(0,5),end_time:new Date(d.end_at).toTimeString().slice(0,5)}));}
export function progressCapture(edit,now=new Date()){
 const start=edit.started_at||localStart(edit.date,edit.time);
 const end=edit.action==='finish'?localStart(edit.finish_date,edit.finish_time):now.toISOString();
 if(!start||!end||new Date(end)<=new Date(start)||new Date(end)>now)return {error:'pl_finish_invalid'};
 const a=new Date(start),b=new Date(end),report={start_time:a.toTimeString().slice(0,5),end_time:b.toTimeString().slice(0,5),ends_next_day:localDate(a)!==localDate(b),downtime_events:edit.downtime_events||[]};
 const schedule=downtimeSchedule(report);
 if(report.downtime_events.length&&schedule.error)return {error:schedule.error};
 const events=schedule.events.map(d=>{
  const first=new Date(a);if(d.start_time<a.toTimeString().slice(0,5))first.setDate(first.getDate()+1);
  const last=new Date(a);if(d.end_time<a.toTimeString().slice(0,5))last.setDate(last.getDate()+1);
  return {type:d.type,note:d.note||'',start_at:localStart(localDate(first),d.start_time),end_at:localStart(localDate(last),d.end_time)};
 });
 return {start,end,events,report:{...report,downtime_events:schedule.events}};
}
export function stoppedMinutes(run,from,to,unplannedOnly=false){
 const a=new Date(from).getTime(),b=new Date(to).getTime();
 return (run.downtime_events||[]).reduce((sum,d)=>{
  if(unplannedOnly&&['break','lunch'].includes(d.type))return sum;
  return sum+Math.max(0,Math.min(b,new Date(d.end_at).getTime())-Math.max(a,new Date(d.start_at).getTime()))/60000;
 },0);
}
export function runHours(run,at=new Date()){
 const end=new Date(Math.min(new Date(at).getTime(),run.closed_at?new Date(run.closed_at).getTime():Infinity));
 const elapsed=Math.max(0,(end-new Date(run.started_at))/3600000);
 return {elapsed,working:Math.max(0,elapsed-stoppedMinutes(run,run.started_at,end)/60),downtime:stoppedMinutes(run,run.started_at,end,true)};
}
export function progressRate(run,at,quantity){
 const hours=runHours(run,at).working;return hours>0?Number(quantity||0)/hours:0;
}
export function dashboardTable(runs,checkpoints,day,now=new Date()){
 const range=dayRange(day);if(!range||!runs.length)return {columns:[],rows:[]};
 const dayStart=new Date(range.p_from).getTime(),dayEnd=new Date(range.p_to).getTime();
 const first=Math.max(dayStart,Math.min(...runs.map(r=>new Date(r.started_at).getTime())));
 const last=Math.min(dayEnd,Math.max(...runs.map(r=>new Date(r.started_at).getTime()+(Number(r.shift_hours||8)+.5)*3600000)));
 const columns=[];for(let at=first;at<last;at+=7200000)columns.push(new Date(at));
 const rows=runs.map(run=>{
  const reports=checkpoints.filter(c=>c.run_id===run.id&&new Date(c.recorded_at)<new Date(range.p_to)).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)||a.id.localeCompare(b.id));
  const latest=reports.at(-1),quantity=Number(latest?.quantity??run.period_quantity??0);
  const limit=Math.min(now.getTime(),dayEnd,run.closed_at?new Date(run.closed_at).getTime():Infinity);
  const hours=runHours(run,new Date(limit));let previous=run.started_at,previousQty=0;
  const rates=reports.map(c=>{const elapsed=(new Date(c.recorded_at)-new Date(previous))/3600000-stoppedMinutes(run,previous,c.recorded_at)/60;const rate=elapsed>0?(Number(c.quantity)-previousQty)/elapsed:null;previous=c.recorded_at;previousQty=Number(c.quantity);return rate;}).filter(v=>v!==null);
  return {run,quantity,efficiency:Number(run.shift_target)>0?quantity/Number(run.shift_target)*100:0,average:rates.length?rates.reduce((a,b)=>a+b,0)/rates.length:0,target:Number(run.shift_target||0)/effectiveShiftHours(run.shift_hours),...hours,cells:columns.map((at,index)=>reports.filter(c=>new Date(c.recorded_at)>=at&&new Date(c.recorded_at)<(columns[index+1]||new Date(last))).at(-1)?.quantity??null)};
 });
 return {columns,rows};
}
