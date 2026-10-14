import {localDate,localStart,dayRange,liveKpis} from './live.mjs';
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
export function adjustedTarget(run,at=new Date()){
 return Number(run.shift_target||0)/effectiveShiftHours(run.shift_hours)*runHours(run,at).working;
}
// Reporting cadence pauses for lunch; other downtime affects rates, not the clock labels.
export function reportingCuts(run,end,closed=true){
 const start=new Date(run.started_at).getTime(),last=new Date(end).getTime();
 const lunches=(run.downtime_events||[]).filter(d=>d.type==='lunch').map(d=>[new Date(d.start_at).getTime(),new Date(d.end_at).getTime()]).sort((a,b)=>a[0]-b[0]);
 const cuts=[start];let previous=start;
 while(previous<last){
  let next=previous+7200000;
  for(const [a,b] of lunches)if(a>=previous&&a<next)next+=Math.max(0,b-Math.max(a,previous));
  if(next>=last){if(!closed)cuts.push(next);break;}
  cuts.push(next);previous=next;
 }
 if(closed&&last>start)cuts.push(last);
 return cuts;
}
export function dashboardTable(runs,checkpoints,day,now=new Date()){
 const range=dayRange(day);if(!range||!runs.length)return {columns:[],rows:[]};
 const dayStart=new Date(range.p_from).getTime(),dayEnd=new Date(range.p_to).getTime();
 const scheduled=runs.map(run=>{
  const reports=checkpoints.filter(c=>c.run_id===run.id&&new Date(c.recorded_at)<dayEnd).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)||a.id.localeCompare(b.id));
  const latest=reports.at(-1),at=latest?.recorded_at||run.period_at||run.latest_at;
  const end=Math.min(dayEnd,run.closed_at?new Date(run.closed_at).getTime():Math.max(new Date(at||run.started_at).getTime(),Math.min(now.getTime(),dayEnd)));
  return {run,reports,at,end,cuts:reportingCuts(run,end,!!run.closed_at).filter(at=>at>=dayStart&&at<=dayEnd)};
 });
 const columns=[...new Set(scheduled.flatMap(row=>row.cuts))].sort((a,b)=>a-b).map(at=>new Date(at));
 const rows=scheduled.map(({run,reports,at,end,cuts})=>{
  const latest=reports.at(-1),quantity=Number(latest?.quantity??run.period_quantity??run.latest_quantity??0);
  const measuredAt=at?new Date(at):new Date(end),measured=runHours(run,measuredAt);
  const expected=adjustedTarget(run,measuredAt),hours=runHours(run,new Date(end));
  const values=new Map();
  for(const report of reports){
   const cut=cuts.find(cut=>cut>=new Date(report.recorded_at).getTime());
   if(cut!==undefined)values.set(cut,Number(report.quantity));
  }
  return {run,quantity,efficiency:expected>0?quantity*100/expected:0,average:measured.working>0?quantity/measured.working:0,target:Number(run.shift_target||0)/effectiveShiftHours(run.shift_hours),expected,...hours,cells:columns.map(at=>values.get(at.getTime())??null)};
 });
 return {columns,rows};
}
