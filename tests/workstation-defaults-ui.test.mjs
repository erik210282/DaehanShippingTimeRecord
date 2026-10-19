import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const items=[...['a','b','c'].map(id=>({id,active:true,category:'FG',part_number:'PN-'+id.toUpperCase(),part_name:'Part '+id.toUpperCase(),uom:'PCS'})),...[1,2,3].map(n=>({id:'raw'+n,active:true,category:'RAW',part_number:'RAW-'+n,part_name:'Material '+n,uom:'kg'}))];
const stations=[{code:'M1',name:'Assembly',machine_type:'Assembly',active:true,materials:['a','b','raw1','raw2'].map(item_id=>({item_id}))},{code:'M2',name:'Second machine',machine_type:'Assembly',active:true,materials:[{item_id:'b'},{item_id:'raw2'}]}];
const template={id:'tpl',name:'Assembly',active:true,version:1,machine_types:['Assembly'],fields:[{id:'pressure',label:'Pressure',input_type:'numeric',minimum:0,maximum:100,unit:'bar'}]};
const name='.workstation-defaults-ui',files=[name+'.html',name+'.jsx'];
fs.writeFileSync(files[0],'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Modal from 'react-modal';import Production from './src/pages/Production';import Live from './src/production/ProductionLive';import Supply from './src/production/ProductionSupply';import Parameters from './src/production/ProductionParameters';import i18n from './src/i18n/i18n';import {registerProduction} from './src/production/translations';import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';registerProduction(i18n);i18n.changeLanguage('en');Modal.setAppElement('#root');const screen=new URLSearchParams(location.search).get('screen'),items=${JSON.stringify(items)},stations=${JSON.stringify(stations)},common={items,stations,manage:true,supervisor:true,reporterName:'Tester'};createRoot(document.getElementById('root')).render(<BrowserRouter>{screen==='daily'?<Production access={{admin:true,userId:'tester',memberships:[]}}/>:screen==='partial'?<Live {...common} mode="partial"/>:screen==='parameters'?<Parameters {...common} mode="parameters"/>:<Supply {...common} mode={screen==='shifts'?'shifts':'materials'}/>}</BrowserRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4190','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4190/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/rest/v1/**',route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  const data=table==='inventory_items'?items:table==='inventory_workstations'?stations:table==='operadores'?[{uid:'tester',nombre:'Tester'}]:table==='production_live_snapshot_range'?{targets:items.filter(i=>i.category==='FG').map(i=>({item_id:i.id,target_8h:800,target_10h:1000})),runs:[],checkpoints:[]}:table==='production_supply_snapshot'?{materials:[],runs:[],loads:[],wip:[],baselines:[]}:table==='production_parameter_snapshot'?{templates:[template],reports:[],total:0}:[];
  return route.fulfill({json:data});
 });
 async function choose(dialog,label,option,index=0){await dialog.getByRole('combobox',{name:label,exact:true}).nth(index).click();await page.getByRole('option',{name:option,exact:true}).click();}
 for(const screen of ['partial','daily','materials','parameters','shifts']){
  await page.goto('http://127.0.0.1:4190/'+files[0]+'?screen='+screen+'&production=records');
  if(screen==='daily')await page.getByRole('button',{name:/Record production/}).click();
  else await page.locator('.live-page-header button').click();
  const dialog=page.getByRole('dialog').first(),stationLabel=screen==='daily'?'Code':'Workstation';
  await choose(dialog,stationLabel,'M1 · Assembly');
  const productFields=dialog.locator('label.catalog-field').filter({has:page.getByRole('combobox',{name:'Part',exact:true})}),selection=productFields.first();
  const raw=screen==='materials',first=raw?'RAW-1 · Material 1 · kg':'PN-A · Part A',second=raw?'RAW-2 · Material 2 · kg':'PN-B · Part B',extra=raw?'RAW-3 · Material 3 · kg':'PN-C · Part C';
  await selection.getByLabel('Remove '+first,{exact:true}).waitFor();
  await selection.getByLabel('Remove '+second,{exact:true}).waitFor();
  let reading;
  if(screen==='parameters'){reading=dialog.getByLabel('Actual reading · Pressure',{exact:true});await reading.fill('10');}
  await selection.getByLabel('Remove '+second,{exact:true}).click();
  await choose(dialog,'Part',extra);
  assert.equal(await selection.getByLabel('Remove '+second,{exact:true}).count(),0);
  assert.equal(await selection.getByLabel('Remove '+extra,{exact:true}).count(),1);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(250);
  assert.equal(await selection.getByLabel('Remove '+second,{exact:true}).count(),0,'Refresh does not restore a removed default: '+screen);
  await choose(dialog,stationLabel,'M1 · Assembly');
  assert.equal(await selection.getByLabel('Remove '+second,{exact:true}).count(),0,'Selecting the same station preserves manual choices: '+screen);
  if(reading)assert.equal(await reading.inputValue(),'10','Removing/adding products preserves parameter readings');
  if(screen==='shifts'){
   await dialog.getByRole('button',{name:'Add machine',exact:true}).click();
   await choose(dialog,'Workstation','M2 · Second machine',1);
   assert.equal(await selection.getByLabel('Remove '+first,{exact:true}).count(),1,'Second machine does not change first machine products');
   assert.equal(await productFields.nth(1).getByLabel('Remove '+second,{exact:true}).count(),1,'Second machine gets its own configured product');
  }else{
   await choose(dialog,stationLabel,'M2 · Second machine');
   await selection.getByLabel('Remove '+second,{exact:true}).waitFor();
   assert.equal(await selection.getByLabel('Remove '+first,{exact:true}).count(),0,'Changing the workstation loads its own defaults');
  }
  console.log('PASS automatic assigned products with editable selection: '+screen);
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();for(const f of files)fs.rmSync(f,{force:true});}
