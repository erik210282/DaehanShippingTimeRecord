import {localStart} from './live.mjs';
import {productPlanHours,machinePlanHours,validPlanHours} from './machineBom.mjs';
export function shiftPlanPayload(edit){
 return {id:edit.id,schedule_id:edit.schedule_id,schedule_version:edit.schedule_version,
 started_at:localStart(edit.date,edit.time),shift_hours:edit.shift_hours,
 planned_hours:edit.planned_hours||edit.shift_hours,
 stations:edit.stations.map(row=>({station_code:row.station_code,item_ids:row.item_ids,
 started_at:localStart(edit.date,row.custom_time??edit.time),
 planned_hours:machinePlanHours(row,edit),product_hours:productPlanHours(row,edit)}))};
}
export function shiftPlanProblem(plan){
 if(!plan.started_at||![8,10].includes(Number(plan.shift_hours))||!plan.stations.length||plan.stations.length>30||
 new Set(plan.stations.map(r=>r.station_code)).size!==plan.stations.length||
 plan.stations.some(r=>!r.station_code||!r.item_ids?.length||!r.started_at||
 !Number.isFinite(Number(r.planned_hours))||Number(r.planned_hours)<0.5||Number(r.planned_hours)>24||Object.values(r.product_hours||{}).some(h=>!validPlanHours(h))))return 'pl_start_invalid';
 return '';
}

