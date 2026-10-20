import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for (const path of ['src/realtime.js','../mobile/realtime.js'].filter(p=>fs.existsSync(p))) {
 let now=0,next=0,calls=0,event,status,wake,removed=false;
 const jobs=new Map(),listeners=new Map();
 const add=(fn,delay,repeat=false)=>{const id=++next;jobs.set(id,{fn,at:now+delay,delay,repeat});return id;};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const window={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const AppState={currentState:'active',addEventListener:(_,f)=>{wake=f;return {remove:()=>{wake=null;}};}};
 const channel={on:(_,filter,f)=>{event=f;return channel;},subscribe:f=>{status=f;return channel;}};
 const db={channel:()=>channel,removeChannel:()=>{removed=true;}};
 const source=fs.readFileSync(path,'utf8').replace(/^import .*\n/gm,'').replaceAll('export ','');
 const context=vm.createContext({AppState,document,window,Math,setTimeout:(f,d)=>add(f,d),setInterval:(f,d)=>add(f,d,true),clearTimeout:id=>jobs.delete(id),clearInterval:id=>jobs.delete(id)});
 vm.runInContext(source,context);
 const off=context.subscribeUpdates(db,'test',['catalog_updates'],async()=>{calls++;});
 const advance=async ms=>{const end=now+ms;while(true){const first=[...jobs.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!first)break;const [id,j]=first;now=j.at;if(j.repeat)j.at+=j.delay;else jobs.delete(id);j.fn();await Promise.resolve();await Promise.resolve();}now=end;};
 status('SUBSCRIBED');await advance(101);assert.equal(calls,1);
 await advance(90000);assert.equal(calls,1,'Healthy subscriptions must not poll or refresh every 10 seconds');
 event();event();event();await advance(101);assert.equal(calls,2,'Coalesce atomic change bursts');
 status('CHANNEL_ERROR');await advance(30000);assert.equal(calls,3,'Disconnected clients recover snapshots');
 document.visibilityState='hidden';AppState.currentState='background';await advance(60000);assert.equal(calls,3,'Background clients do not poll');
 document.visibilityState='visible';AppState.currentState='active';if(wake)wake('active');else listeners.get('focus')();await advance(101);assert.equal(calls,4,'Returning to page reloads current data');
 off();await advance(60000);assert.equal(calls,4);assert.equal(removed,true);assert.equal(jobs.size,0);assert.equal(listeners.size,0);
 console.log('PASS: '+path+' healthy realtime, coalescing, recovery, visibility and cleanup');
}
