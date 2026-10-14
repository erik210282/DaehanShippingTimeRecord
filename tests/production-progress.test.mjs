import assert from 'node:assert/strict';
import {uphTarget,synchronizedTargets,runHours,dashboardTable,progressCapture} from '../src/production/progress.mjs';
const targets=synchronizedTargets({},'target_8h','750');
assert.equal(Number(targets.target_10h),930);assert.equal(uphTarget(targets),100);
const start=new Date(2026,9,10,8),end=new Date(2026,9,10,10);
const run={id:'a',station_code:'M1',item_id:'A',started_at:start.toISOString(),closed_at:end.toISOString(),shift_hours:8,shift_target:750,attainment:94.7,expected_quantity:158.4,period_quantity:150,period_at:end.toISOString(),downtime_events:[{type:'break',start_at:new Date(2026,9,10,8,15).toISOString(),end_at:new Date(2026,9,10,8,30).toISOString()},{type:'breakdown',start_at:new Date(2026,9,10,9).toISOString(),end_at:new Date(2026,9,10,9,10).toISOString()}]};
assert.equal(runHours(run,end).elapsed,2);assert.equal(runHours(run,end).downtime,10);assert.ok(Math.abs(runHours(run,end).working-(2-25/60))<1e-9);
const cps=[{id:'c1',run_id:'a',recorded_at:new Date(2026,9,10,9).toISOString(),quantity:75},{id:'c2',run_id:'a',recorded_at:end.toISOString(),quantity:150}];
const table=dashboardTable([run],cps,'2026-10-10',end);assert.equal(table.columns[0].time.getHours(),8);assert.equal(table.columns[1].time.getHours(),10);assert.equal(table.rows[0].quantity,150);assert.ok(Math.abs(table.rows[0].efficiency-150/(100*(2-25/60))*100)<1e-9);assert.equal(table.rows[0].target,100);assert.deepEqual(table.rows[0].cells,[0,75,150]);assert.ok(Math.abs(table.rows[0].average-150/(2-25/60))<1e-9);
assert.equal(progressCapture({action:'finish',started_at:start.toISOString(),finish_date:'2026-10-10',finish_time:'10:00',downtime_events:[]},new Date(2026,9,10,11)).end,end.toISOString());
assert.equal(progressCapture({action:'finish',started_at:start.toISOString(),finish_date:'2026-10-10',finish_time:'12:00',downtime_events:[]},new Date(2026,9,10,11)).error,'pl_finish_invalid');
console.log('PASS: effective targets, final time, two-hour columns, cumulative results, interval UPH and downtime categories');

const d=(hour,minute=0)=>new Date(2026,9,13,hour,minute).toISOString();
const overtime={id:'overtime',started_at:d(6),closed_at:d(16,30),shift_hours:8,shift_target:457,downtime_events:[{type:'break',start_at:d(8),end_at:d(8,15)},{type:'break',start_at:d(10),end_at:d(10,15)},{type:'lunch',start_at:d(12),end_at:d(12,30)},{type:'break',start_at:d(14,30),end_at:d(14,45)}]};
const overtimeTable=dashboardTable([overtime],[{id:'1',run_id:'overtime',recorded_at:d(9,13),quantity:100},{id:'2',run_id:'overtime',recorded_at:d(13,12),quantity:330},{id:'3',run_id:'overtime',recorded_at:d(16,30),quantity:474}],'2026-10-13',new Date(d(17)));
assert.deepEqual(overtimeTable.rows[0].cells,[0,100,330,474]);assert.deepEqual(overtimeTable.columns.map(c=>c.index),[0,1,2,3]);
assert.equal(overtimeTable.rows[0].cells.at(-1),474);
assert.ok(Math.abs(overtimeTable.rows[0].average-474/9.25)<1e-9);
assert.ok(Math.abs(overtimeTable.rows[0].expected-457/7.5*9.25)<1e-9);
const early=dashboardTable([{...overtime,closed_at:d(15,47)}],[{id:'last',run_id:'overtime',recorded_at:d(15,47),quantity:420}],'2026-10-13',new Date(d(17)));
assert.equal(early.columns.length,2);assert.equal(early.rows[0].recordedTimes.at(-1).getMinutes(),47);assert.equal(early.rows[0].cells.at(-1),420);
console.log('PASS: overtime, lunch-adjusted cuts, weighted UPH and exact closing time');

const lateStart=d(6),secondStart=d(14);
const firstShift={id:'first',station_code:'M1',started_at:lateStart,shift_hours:8,shift_target:750};
const secondShift={...firstShift,id:'second',started_at:secondStart};
const irregular=dashboardTable([firstShift,secondShift],[
 {id:'one',run_id:'first',recorded_at:d(9,13),quantity:100},
 {id:'two',run_id:'first',recorded_at:d(9,20),quantity:125},
 {id:'three',run_id:'first',recorded_at:d(13,45),quantity:300},
 {id:'four',run_id:'second',recorded_at:d(16,47),quantity:80}
 ],'2026-10-13',new Date(d(18)));
assert.deepEqual(irregular.rows[0].cells,[0,100,125,300],'Late or nearby captures must never overwrite each other');
assert.deepEqual(irregular.rows[1].cells,[0,80,null,null],'Second shift restarts numbering');
assert.equal(irregular.rows[1].scheduledTimes[0].getHours(),14);
assert.equal(irregular.rows[1].scheduledTimes[1].getHours(),16);
assert.equal(irregular.columns[1].time,null,'Different shift times cannot share a misleading clock header');
const initial=dashboardTable([firstShift],[{id:'zero',run_id:'first',recorded_at:d(6),quantity:7},{id:'next',run_id:'first',recorded_at:d(7),quantity:50}],'2026-10-13',new Date(d(18)));
assert.deepEqual(initial.rows[0].cells,[7,50],'Opening reading belongs to Start, followed by report 1');
console.log('PASS: ordinal reports, initial readings, irregular timestamps, independent second shifts and no overwritten captures');
