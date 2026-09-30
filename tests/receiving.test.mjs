import assert from 'node:assert/strict';
import {api,quantity,allowedLocations,receiptState,effectiveSeconds,productivity,finishLines,localDay} from '../src/receiving/api.js';
assert.equal(quantity('1,5'),1.5);
for(const value of ['',null,'NaN','Infinity','-1','0']) assert.throws(()=>quantity(value));
assert.equal(quantity('0',true),0);
const locations=[{id:'a',kind:'STORAGE',active:true},{id:'b',kind:'STORAGE',active:true},{id:'c',kind:'STORAGE',active:false},{id:'d',kind:'RECEIVING',active:true}];
assert.equal(allowedLocations('x',locations,[]).length,3);
assert.deepEqual(allowedLocations('x',locations,[{item_id:'x',location_id:'b'}]).map(l=>l.id),['b']);
assert.equal(allowedLocations('x',locations,[{item_id:'x',location_id:'c'}]).length,0);
assert.equal(receiptState({id:'r',status:'received'},[{receipt_id:'r',received:10,stored:10}],[]),'completed');
assert.equal(receiptState({id:'r',status:'received'},[{receipt_id:'r',received:10,stored:4}],[]),'process');
assert.equal(receiptState({id:'r',status:'received'},[],[{receipt_id:'r',status:'paused'}]),'paused');
const task={operator_id:'u',kind:'unload',receipt_id:'r',started_at:'2026-09-29T12:00:00Z',finished_at:'2026-09-29T13:00:00Z',pause_seconds:600,status:'finished'};
assert.equal(effectiveSeconds(task),3000);
assert.equal(productivity([task],[{receipt_id:'r',received:10,uom:'EA'},{receipt_id:'r',received:20,uom:'KG'}])[0].uph,null);
assert.equal(productivity([task],[{receipt_id:'r',received:10,uom:'EA'}])[0].uph,12);
assert.throws(()=>finishLines([{id:'l',expected:10}],{l:{received:'5',damaged:'6',note:'damage'}}));
assert.throws(()=>finishLines([{id:'l',expected:10}],{l:{received:'5',damaged:'1',note:''}}));
assert.equal(finishLines([{id:'l',expected:10}],{l:{received:'12',damaged:'2',note:'Reported'}})[0].received,12);
assert.match(localDay('2026-09-29T12:00:00Z'),/^2026-09-29$/);
console.log('PASS: quantities, location permissions, statuses, pause exclusion, mixed units and damage validation');


// Production grants protect unit_cost; select('*') must never break the whole Receiving loader.
const material={id:'raw',part_number:'RAW-1',description:'Material',category:'RAW',uom:'EA',active:true};
const restrictedDb={from(table){let columns;const q={select(value){columns=value;return q;},order(){return q;},range(){return q;},in(){return q;},then(resolve){const denied=table==='inventory_items'&&columns==='*';return Promise.resolve({data:denied?null:table==='inventory_items'?[material]:[],error:denied?{code:'42501',message:'permission denied'}:null}).then(resolve);}};return q;},rpc:async()=>({data:[],error:null})};
assert.deepEqual((await api(restrictedDb).load()).items,[{...material,material_type:'RAW'}]);
console.log('PASS: Receiving loads against restricted product column permissions');
