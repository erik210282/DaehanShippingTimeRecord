import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=fs.existsSync('src/production/supply.mjs')?'src/production/supply.mjs':'production/supply.js';
const source=fs.readFileSync(file,'utf8').replace(/export /g,'');
const {partLabel,contributorNames,supplyRows,shiftCapture}=vm.runInNewContext(source+'\n({partLabel,contributorNames,supplyRows,shiftCapture})');
assert.equal(partLabel({part_number:'PN',productos:{nombre:'Assembly'}}),'PN · Assembly');
assert.equal(contributorNames({id:'r'},[{run_id:'r',created_by:'a'},{run_id:'r',created_by:'b'},{run_id:'r',created_by:'a'}],[{uid:'a',nombre:'Ana'},{uid:'b',nombre:'Luis'}]),'Ana, Luis');
assert.equal(contributorNames({id:'r',contributors:[{uid:'a',name:'Ana'},{uid:'b',name:'Luis'}]},[],[]),'Ana, Luis');
const at=new Date('2026-10-11T10:00:00Z');
const base={materials:[{station_code:'M',item_id:'raw',loaded_quantity:1000,tracked_at:'2026-10-11T08:00:00Z',alert_minutes:60}],runs:[{id:'r',station_code:'M',started_at:'2026-10-11T08:00:00Z',pieces_per_hour:100,raw_recipe:[{item_id:'raw',per_unit:2}]}]};
let row=supplyRows(base,at)[0];assert.equal(row.rate,200);assert.equal(row.estimated,600);assert.equal(row.minutes,180);assert.equal(row.low,false);
const run={...base.runs[0],latest_quantity:50,latest_at:'2026-10-11T09:00:00Z'};
row=supplyRows({...base,runs:[run]},at)[0];assert.equal(row.rate,100);assert.equal(row.estimated,800);
row=supplyRows({...base,materials:[{...base.materials[0],loaded_quantity:200}],runs:[run]},at)[0];assert.equal(row.estimated,0);assert.equal(row.low,true);
row=supplyRows({...base,runs:[{...run,closed_at:run.latest_at}]},at)[0];assert.equal(row.rate,0);assert.equal(row.estimated,900);
row=supplyRows({...base,materials:[{...base.materials[0],confirmed_consumption:100}],runs:[]},at)[0];assert.equal(row.estimated,900,'Posted report replaces estimate instead of consuming twice');
row=supplyRows({...base,baselines:[{station_code:'M',item_id:'raw',run_id:'r',quantity:50}],runs:[run]},at)[0];assert.equal(row.estimated,900,'Production before first station allocation is excluded');
row=supplyRows({...base,runs:[{...run,downtime_events:[{start_at:'2026-10-11T09:00:00Z',end_at:'2026-10-11T10:00:00Z'}]}]},at)[0];assert.equal(row.estimated,900,'Registered downtime stops projected consumption');
const edit=shiftCapture({id:'draft'},'session',[{id:'r',session_id:'session',station_code:'M',item_id:'p',started_at:'2026-10-11T08:00:00Z'}],()=> 'row');
assert.equal(edit.live_run_id,'r');assert.equal(edit.start_time,new Date('2026-10-11T08:00:00Z').toTimeString().slice(0,5));assert.equal(edit.machine_quantity,'');
assert.equal(shiftCapture(edit,'',[],()=> 'row').live_run_id,null);
row=supplyRows({...base,materials:[{...base.materials[0],tracked_at:at.toISOString()}]},at)[0];assert.equal(row.estimated,1000,'First physical loading excludes elapsed time before loading');
console.log('Station forecasts, handoff attribution and shift-linked capture passed');

const handoff=shiftCapture({id:'new'},'closed:r',[{id:'r',session_id:'session',station_code:'M',item_id:'p',started_at:'2026-10-13T13:00:00Z',closed_at:'2026-10-13T23:30:00Z',latest_quantity:474,latest_at:'2026-10-13T23:30:00Z'}],()=> 'new-row',[{id:'existing',live_run_id:'r',item_id:'p',status:'draft',capture_group_id:'session',people:null,machine_quantity:474,scrap_quantity:null,downtime_events:[]}]);
assert.equal(handoff.id,'existing');assert.equal(handoff.products[0].id,'existing');assert.equal(handoff.people,'');assert.equal(handoff.scrap_quantity,'');assert.equal(handoff.machine_quantity,474);

const runs=[{id:'one',session_id:'shared',item_id:'p',started_at:'2026-10-13T06:00:00Z',closed_at:'2026-10-13T12:00:00Z',downtime_events:[{type:'breakdown',start_at:'2026-10-13T08:00:00Z',end_at:'2026-10-13T08:15:00Z'}]},{id:'two',session_id:'shared',item_id:'q',started_at:'2026-10-13T06:00:00Z',downtime_events:[]}];
assert.deepEqual(Array.from(shiftCapture({},'shared',runs,()=> 'x').products,p=>p.item_id),['q']);
assert.deepEqual(Array.from(shiftCapture({},'closed:one',runs,()=> 'x').products,p=>p.item_id),['p']);
const together=shiftCapture({},'shared',runs.map(r=>({...r,closed_at:null})),()=> 'x');
assert.equal(together.products[0].downtime_events.length,1);assert.equal(together.products[1].downtime_events.length,0);
console.log('PASS independent closed handoffs and product downtime isolation');

const {stationRawIds,updateLoadEntry,materialLoadPayload}=vm.runInNewContext(source+'\n({stationRawIds,updateLoadEntry,materialLoadPayload})');
const materialItems=['a','b','unrelated'].map(id=>({id,active:true,category:'RAW'}));
const stationData={station_materials:[{station_code:'M1',item_id:'a'},{station_code:'M1',item_id:'b'},{station_code:'M2',item_id:'b'}]};
assert.deepEqual(Array.from(stationRawIds(stationData,[],materialItems,'M1')),['a','b']);
assert.equal(stationRawIds(stationData,[],materialItems,'').length,0);
assert.equal(stationRawIds(stationData,[],materialItems,'UNKNOWN').length,0);
const getEntries=e=>e.entries.map(row=>({...row,station_code:e.station_code}));
let load={station_code:'M1',item_id:'a',quantity:'',entries:[{id:'1',item_id:'a',quantity:''},{id:'2',item_id:'b',quantity:''}]};
load=updateLoadEntry(load,'a',{quantity:'12.5'},getEntries);
load=updateLoadEntry(load,'b',{quantity:'34'},getEntries);
assert.equal(load.entries[0].quantity,'12.5');assert.equal(load.entries[1].quantity,'34');assert.equal(load.quantity,'12.5');
const payload=materialLoadPayload({},load,getEntries);assert.deepEqual(Array.from(payload.entries,r=>r.quantity),['12.5','34']);assert.ok(payload.entries.every(r=>r.alert_minutes===15));
// Two working hours at 100 RAW/h. Alert exactly at 15 min regardless of old stored threshold.
const forecast={...base,runs:[run],materials:[{...base.materials[0],loaded_quantity:225,alert_minutes:300}]};
assert.equal(supplyRows(forecast,at)[0].low,true);
assert.equal(supplyRows({...forecast,materials:[{...forecast.materials[0],loaded_quantity:226}]},at)[0].low,false);
assert.equal(supplyRows({...forecast,runs:[] ,materials:[{...forecast.materials[0],loaded_quantity:0}]},at)[0].low,false,'No replenishment pop-up for inactive machinery');
console.log('PASS separate load fields/payload, station filtering, fixed 15-minute threshold and active machine alerts');

assert.deepEqual(Array.from(stationRawIds(stationData,[{code:'M1',raw_material_ids:['b'],materials:[{item_id:'a'}]}],materialItems,'M1')),['b'],'Explicit station RAW assignment overrides stale legacy or snapshot choices');
assert.equal(stationRawIds(stationData,[{code:'M1',raw_material_ids:[]}],materialItems,'M1').length,0,'Clearing workstation RAW must not fall back to BOM or previous assignments');
console.log('PASS explicit workstation RAW list and intentionally empty selection');
