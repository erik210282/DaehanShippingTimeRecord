// Factory clock: 05:00 starts share the 06:00 day schedule; night breaks follow the 17:00 schedule.
export function fixedShiftEvents(startedAt,endedAt){
 const start=new Date(startedAt),end=new Date(endedAt);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)return [];
 const hour=start.getHours(),night=hour>=15||hour<5,anchor=new Date(start);anchor.setHours(0,0,0,0);if(night&&hour<5)anchor.setDate(anchor.getDate()-1);
 const offsets=night?[1140,1260,1380,1530]:[480,600,720,870],events=[];
 for(let n=0;n<16;n++){const minute=n<4?offsets[n]:offsets[3]+(n-3)*120;
  const a=new Date(anchor);a.setMinutes(minute);const b=new Date(a.getTime()+(n===2?30:15)*60000);
  if(a>=end)break;if(b<=start)continue;
  events.push({type:n===2?'lunch':'break',planned:true,automatic:true,schedule_key:anchor.getFullYear()+'-'+anchor.getMonth()+'-'+anchor.getDate()+':'+minute,note:'',start_at:new Date(Math.max(+a,+start)).toISOString(),end_at:new Date(Math.min(+b,+end)).toISOString()});
 }return events;
}
export function mergeShiftEvents(start,end,events=[]){
 const lo=+new Date(start),hi=+new Date(end);
 const inactive=events.filter(e=>e.type==='inactive').flatMap(e=>{const a=Math.max(lo,+new Date(e.start_at)),b=Math.min(hi,+new Date(e.end_at));return b>a?[{...e,automatic:true,planned:true,start_at:new Date(a).toISOString(),end_at:new Date(b).toISOString()}]:[];});
 const subtract=(spans,masks)=>masks.reduce((all,f)=>{const a=+new Date(f.start_at),b=+new Date(f.end_at);return all.flatMap(([x,y])=>y<=a||x>=b?[[x,y]]:[[x,Math.min(y,a)],[Math.max(x,b),y]].filter(([l,r])=>r>l));},spans);
 const fixed=fixedShiftEvents(start,end).flatMap(e=>subtract([[+new Date(e.start_at),+new Date(e.end_at)]],inactive).map(([a,b])=>({...e,start_at:new Date(a).toISOString(),end_at:new Date(b).toISOString()}))),result=[...inactive,...fixed];
 for(const event of events){if(event.automatic||event.type==='inactive')continue;const a0=+new Date(event.start_at),b0=+new Date(event.end_at);
  if(Number.isFinite(a0)&&Number.isFinite(b0)&&(a0<lo||b0>hi||b0<=a0)){result.push(event);continue;}
  let spans=[[Math.max(lo,a0),Math.min(hi,b0)]];
  if(!Number.isFinite(spans[0][0])||!Number.isFinite(spans[0][1])){result.push(event);continue;}
  for(const f of [...fixed,...inactive]){const a=+new Date(f.start_at),b=+new Date(f.end_at);spans=spans.flatMap(([x,y])=>y<=a||x>=b?[[x,y]]:[[x,Math.min(y,a)],[Math.max(x,b),y]].filter(([l,r])=>r>l));}
  for(const [a,b]of spans)if(b>a)result.push({...event,start_at:new Date(a).toISOString(),end_at:new Date(b).toISOString()});
 }return result.sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));
}
const clock=d=>new Date(d).toTimeString().slice(0,5);
export function reportWithAutomaticBreaks(report,now=new Date()){
 const start=report.started_at?new Date(report.started_at):new Date((report.production_date||report.date||'2000-01-01')+'T'+(report.start_time||report.time||'')+':00');
 const date=new Date(start);if(report.ends_next_day)date.setDate(date.getDate()+1);
 let end;
 if(report.action==='finish')end=report.finish_time?new Date(date.getFullYear(),date.getMonth(),date.getDate(),...report.finish_time.split(':').map(Number)):null;
 else if(report.end_time)end=new Date(date.getFullYear(),date.getMonth(),date.getDate(),...report.end_time.split(':').map(Number));
 else end=report.started_at||report.time?now:null;
 if(!Number.isFinite(+start)||!end||!Number.isFinite(+end)||end<=start)return report;
 const input=(report.downtime_events||[]).map(e=>{
  if(e.automatic||e.type==='inactive')return e;
  if(Object.hasOwn(e,'start_time')||Object.hasOwn(e,'end_time')){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.start_time||'')||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.end_time||'')){const {start_at,end_at,...draft}=e;return draft;}}else return e;
  const a=new Date(start),b=new Date(start);a.setHours(...e.start_time.split(':').map(Number),0,0);b.setHours(...e.end_time.split(':').map(Number),0,0);
  if(a<start)a.setDate(a.getDate()+1);if(b<=a)b.setDate(b.getDate()+1);
  return {...e,start_at:a.toISOString(),end_at:b.toISOString()};
 });
 return {...report,start_time:clock(start),end_time:clock(end),ends_next_day:start.toDateString()!==end.toDateString(),downtime_events:mergeShiftEvents(start,end,input).map(e=>({...e,...(e.start_at&&e.end_at?{start_time:clock(e.start_at),end_time:clock(e.end_at),minutes:(new Date(e.end_at)-new Date(e.start_at))/60000}:{} )}))};
}
export const automaticBreakWords={en:{ab_fixed:'Automatic breaks',ab_hint:'Fixed shift breaks are included automatically; only elapsed minutes are deducted.'},es:{ab_fixed:'Descansos automáticos',ab_hint:'Los descansos del turno se incluyen automáticamente; solo se descuentan los minutos transcurridos.'},ko:{ab_fixed:'자동 휴식',ab_hint:'교대별 정해진 휴식이 자동으로 포함되며 경과한 시간만 차감됩니다.'}};
export function registerAutomaticBreaks(i18n){for(const[lang,copy]of Object.entries(automaticBreakWords))i18n.addResourceBundle(lang,'translation',copy,true,true);}
