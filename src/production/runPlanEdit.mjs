import {shiftPlannedEnd} from './shiftTiming.mjs';
import {localStart,localDate} from './live.mjs';
export function runStartFields(value){const date=new Date(value);return {date:localDate(date),time:date.toTimeString().slice(0,5)};}
export function runStartValue(run,fields){const original=runStartFields(run.started_at);return original.date===fields.date&&original.time===fields.time?run.started_at:localStart(fields.date,fields.time);}
export function runPlanProducts(runs,values,starts){return runs.map(r=>({run_id:r.id,version:r.updated_at||r.created_at,planned_hours:values[r.id],started_at:runStartValue(r,starts[r.id])}));}

export function runPlanStart(runs){return new Date(Math.min(...runs.map(r=>new Date(r.started_at).getTime())));}
export function runPlanEnd(runs){return new Date(Math.max(...runs.map(r=>shiftPlannedEnd(r.started_at,r.planned_hours,r.shift_hours).getTime())));}
