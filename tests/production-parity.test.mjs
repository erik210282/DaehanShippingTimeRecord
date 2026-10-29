import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
for(const [dir,ext] of [[fs.existsSync('src/production/supply.mjs')?'src':'.',fs.existsSync('src/production/supply.mjs')?'mjs':'js']]){
 const source=fs.readFileSync(dir+'/production/supply.'+ext,'utf8').replace(/export /g,'');
 const api=vm.runInNewContext(source+'\n({reportSession,stationRawIds,partLabel})');
 assert.equal(api.partLabel({part_number:'PN',part_name:'hl tslh'}),'PN · HL TSLH');
 const stations=[{code:'M',name:'Machine Name',raw_material_ids:['a','b']}],items=[{id:'a',active:true,category:'RAW'},{id:'b',active:true,category:'SEMI'},{id:'x',active:true,category:'RAW'},{id:'fg',active:true,category:'FG'}];
 assert.equal(JSON.stringify(api.stationRawIds({},stations,items,'M')),JSON.stringify(['a','b']));
 assert.equal(api.stationRawIds({},stations,items,'UNKNOWN').length,0);
 const run={id:'r',session_id:'session',closed_at:'2026-10-29T10:00:00Z',started_at:'2026-10-29T08:00:00Z',station_code:'M',item_id:'fg'};
 let selection=api.reportSession({live_run_id:'r'},[run],items,stations,'Manual');assert.equal(selection.value,'closed:r');assert.match(selection.options.find(o=>o.value===selection.value).label,/M · Machine Name/);
 selection=api.reportSession({station_code:'M',machine_session_id:'gone',production_date:'2026-10-29'},[],items,stations,'Manual');assert.equal(selection.value,'gone');assert.match(selection.options.find(o=>o.value==='gone').label,/M · Machine Name/);
 console.log('PASS',dir,'uppercase, closed session labels, removed sessions and assigned RAW/SEMI only');
}
for(const [dir,mobile] of [[fs.existsSync('src/realtime.js')?'src':'.',!fs.existsSync('src/realtime.js')]]){
 const events=new Map(),timers=new Map();let serial=0,callback,reads=0;
 const context={setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),setInterval:()=>++serial,clearInterval:()=>{},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},AppState:{currentState:'active',addEventListener:()=>({remove(){}})}};
 const s=fs.readFileSync(dir+'/realtime.js','utf8').replace(/^import .*\n/gm,'').replace(/export /g,'');
 const api=vm.runInNewContext(s+'\n({subscribeUpdates,notifyUpdates})',context),db={channel:()=>{const channel={on:()=>channel,subscribe:fn=>{callback=fn;return channel;}};return channel;},removeChannel(){}};
 const off=api.subscribeUpdates(db,'production-test',['catalog_updates'],async()=>{reads++;});
 api.notifyUpdates(db);api.notifyUpdates(db);assert.equal(timers.size,1);awaited();
 function awaited(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}
 assert.equal(reads,1);off();api.notifyUpdates(db);assert.equal(timers.size,0);console.log('PASS',dir,'commit invalidation coalesces and cleans up');
}
