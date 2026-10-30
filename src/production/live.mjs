export function localStart(date,time){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||! /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))return null;const d=new Date(date+'T'+time+':00');if(!Number.isFinite(d.getTime())||d.getFullYear()!==Number(date.slice(0,4))||d.getMonth()+1!==Number(date.slice(5,7))||d.getDate()!==Number(date.slice(8,10))||d.getHours()!==Number(time.slice(0,2))||d.getMinutes()!==Number(time.slice(3,5)))return null;return d.toISOString();}
export function localDate(value=new Date()){const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
export function dayRange(date){const start=localStart(date,'00:00');if(!start)return null;const end=new Date(start);end.setDate(end.getDate()+1);return {p_from:start,p_to:end.toISOString()};}
export function liveKpis(run){
 const quantity=Number(Object.hasOwn(run,'period_quantity')?run.period_quantity??0:run.latest_quantity??0),at=Object.hasOwn(run,'period_at')?run.period_at:run.latest_at;
 const hours=(new Date(at)-new Date(run.started_at))/3600000,targetPending=run.shift_target===null,beforeStart=!!at&&new Date(at)<=new Date(run.started_at);
 const expected=targetPending?null:beforeStart?0:Number(run.expected_quantity||0),attainment=targetPending||beforeStart||!at||run.attainment==null?null:Number(run.attainment);
 return {expected,attainment,gap:targetPending?null:Math.max(0,Math.ceil(expected-quantity)),rate:hours>0?quantity/hours:0,quantity,at,targetPending,beforeStart,performance:attainment==null?'pending':attainment<Number(run.critical_percent)?'critical':attainment<Number(run.warning_percent)?'warning':'on_track'};
}
export function checkpointKpis(run,checkpoint){return liveKpis({...run,period_quantity:checkpoint.quantity,period_at:checkpoint.recorded_at,expected_quantity:checkpoint.expected_quantity,attainment:checkpoint.attainment});}
export function attainmentLabel(k,t,format){return k.targetPending?t('pl_target_pending'):k.attainment==null?'—':format(k.attainment)+'%';}
export function performanceLabel(k,t){return t(k.targetPending?'pl_target_pending':k.beforeStart?'pl_before_start':'pl_status_'+k.performance);}
