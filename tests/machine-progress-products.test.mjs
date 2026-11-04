
import assert from 'node:assert/strict';
import {liveEditor,liveSubmission} from '../src/production/liveEditor.mjs';
import {selectLiveProducts} from '../src/production/multi.mjs';
const now=new Date(),start=new Date(now-2*3600000).toISOString();let n=0;const id=()=>String(++n);
const run=(key,extra={})=>({id:key,item_id:key,station_code:'M1',session_id:key,started_at:start,shift_hours:8,downtime_events:[],...extra});
const runs=[run('a'),run('b',{started_at:new Date(now-3600000).toISOString()}),run('closed',{closed_at:start}),run('deleted',{deleted_at:start}),run('future',{started_at:new Date(+now+3600000).toISOString()}),run('other',{station_code:'M2'}),run('blocked',{can_continue:false})];
let edit=liveEditor(runs[0],'checkpoint',runs,id);
assert.deepEqual(edit.products.map(p=>p.run_id),['a','b']);
edit.products.forEach((p,i)=>p.quantity=String(100+i));
let result=liveSubmission(edit,now);assert.equal(result.action,'checkpoint_batch');assert.deepEqual(result.payload.products.map(p=>p.run_id),['a','b']);
edit=selectLiveProducts(edit,['b'],id);assert.equal(edit.run_id,'b');assert.equal(edit.started_at,runs[1].started_at);assert.equal(edit.quantity,'101');
result=liveSubmission(edit,now);assert.equal(result.action,'checkpoint');assert.equal(result.payload.run_id,'b');assert.equal(result.payload.quantity,'101');
edit=selectLiveProducts(edit,['a','b','unknown'],id);assert.deepEqual(edit.products.map(p=>p.run_id),['a','b']);
edit.products.forEach(p=>p.quantity='120');result=liveSubmission(edit,now);assert.equal(result.action,'checkpoint_batch');assert.deepEqual(result.payload.products.map(p=>p.run_id),['a','b']);
edit=selectLiveProducts(edit,[],id);assert.equal(liveSubmission(edit,now).error,'pm_select_products');
console.log('PASS active machine products across sessions; excludes closed/deleted/future/other/blocked; remove to one, restore original run IDs, reject empty selection');
