
export function formatTimeInput(value) {
 const digits=String(value??'').replace(/[^0-9]/g,'').slice(0,4);
 return digits.length>2?digits.slice(0,2)+':'+digits.slice(2):digits;
}
export function clockMinutes(value) {
 if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(value??'')))return null;
 const [hour,minute]=value.split(':').map(Number);return hour*60+minute;
}
export const blankTimedDowntime=()=>({type:'break',start_time:'',end_time:'',minutes:'',note:''});
export function downtimeSchedule(report) {
 const events=report.downtime_events||[],shiftStart=clockMinutes(report.start_time),shiftEnd=clockMinutes(report.end_time);
 if(shiftStart===null||shiftEnd===null)return {events,error:'pr_time_invalid'};
 const finish=shiftEnd+(report.ends_next_day?1440:0);
 if(finish<=shiftStart||finish-shiftStart>1440)return {events,error:'pr_time_invalid'};
 const ranges=[];let error=null;
 const normalized=events.map(event=>{
  if(!Object.hasOwn(event,'start_time')&&!Object.hasOwn(event,'end_time'))return event;
  let start=clockMinutes(event.start_time),end=clockMinutes(event.end_time);
  if(start===null||end===null||start===end){error='pr_downtime_schedule_invalid';return {...event,minutes:''};}
  if(report.ends_next_day&&start<shiftStart)start+=1440;
  if(report.ends_next_day&&end<shiftStart)end+=1440;
  if(end<=start||start<shiftStart||end>finish){error='pr_downtime_schedule_invalid';return {...event,minutes:''};}
  if(ranges.some(([a,b])=>start<b&&end>a))error='pr_downtime_overlap';
  ranges.push([start,end]);
  return {...event,minutes:end-start};
 });
 return {events:normalized,error};
}
export function normalizeCapture(report) {
 if(!report)return report;
 return {...report,downtime_events:downtimeSchedule(report).events};
}
export function maximumCompleteBoxes(good,piecesPerBox) {
 const pieces=Number(piecesPerBox),available=Number(good);
 return Number.isInteger(pieces)&&pieces>0&&Number.isFinite(available)?Math.floor(Math.max(0,available)/pieces):0;
}
