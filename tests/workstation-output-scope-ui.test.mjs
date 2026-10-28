import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const items=[{id:'a',active:true,category:'FG',part_number:'PN-A',part_name:'Final A',uom:'PCS'},{id:'b',active:true,category:'SEMI',part_number:'PN-B',part_name:'Semi B',uom:'PCS'},{id:'other',active:true,category:'FG',part_number:'PN-OTHER',part_name:'Unassigned',uom:'PCS'}];
const stations=[{code:'M1',name:'First',active:true,materials:[{item_id:'a'}]},{code:'M2',name:'Second',active:true,materials:[{item_id:'b'}]},{code:'M3',name:'Empty',active:true,materials:[]}];
const name='.output-scope-ui';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Modal from 'react-modal';import Production from './src/pages/Production';import Live from './src/production/ProductionLive';import Settings from './src/GlobalSettings';import i18n from './src/i18n/i18n';import {registerProduction} from './src/production/translations';import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';registerProduction(i18n);i18n.changeLanguage('en');Modal.setAppElement('#root');const screen=new URLSearchParams(location.search).get('screen');const access={admin:true,userId:'tester',memberships:[]};createRoot(document.getElementById('root')).render(<BrowserRouter>{screen==='daily'?<Production access={access}/>:screen==='settings'?<Settings access={access}/>:<Live items={JSON.stringify(items)} stations={JSON.stringify(stations)} supervisor reporterName="Tester" mode="dashboard"/>}</BrowserRouter>);`.replace('items={JSON.stringify(items)}','items={'+JSON.stringify(items)+'}').replace('stations={JSON.stringify(stations)}','stations={'+JSON.stringify(stations)+'}'));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4193','--strictPort'],{stdio:'inherit',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4193/'+name+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/rest/v1/**',route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  const run={id:'run-a',item_id:'a',station_code:'M1',session_id:'session-a',started_at:new Date(Date.now()-1800000).toISOString(),closed_at:null,latest_quantity:0,shift_hours:8,target_8h:800,target_10h:1000,warning_percent:90,critical_percent:75,can_manage:true,can_continue:true,created_by:'tester',downtime_events:[]};
  const json=table==='inventory_items'?items:table==='inventory_workstations'?stations:table==='operadores'?[{uid:'tester',nombre:'Tester',activo:true,email:'test@example.com'}]:table==='production_live_snapshot_range'?{targets:items.map(i=>({item_id:i.id,target_8h:800,target_10h:1000})),runs:[run],checkpoints:[]}:table==='production_supply_snapshot'?{materials:[],runs:[],loads:[],wip:[],baselines:[]}:table==='global_department_memberships'?[]:[];
  return route.fulfill({json});
 });
 async function choose(dialog,label,option){await dialog.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
 async function checkParts(dialog,expected,absent){
  const field=dialog.getByRole('combobox',{name:'Part',exact:true});await field.click();
  for(const code of expected)assert.ok((await dialog.innerText()).includes(code)||await page.getByRole('option').filter({hasText:code}).count()>0,'Expected selected or available '+code);
  for(const code of absent)assert.equal(await page.getByRole('option').filter({hasText:code}).count(),0,'Excluded '+code);
  await field.press('Escape');
 }
 for(const screen of ['daily','live']){
  await page.goto('http://127.0.0.1:4193/'+name+'.html?screen='+screen+'&production=records');
  if(screen==='daily')await page.getByRole('button',{name:/Record production/i}).click();
  else await page.locator('.live-machine').getByRole('button',{name:'Edit',exact:true}).click();
  const dialog=page.getByRole('dialog').first();
  const stationLabel=screen==='daily'?'Code':'Workstation';
  if(screen==='daily')await choose(dialog,stationLabel,'M1 · First');
  await checkParts(dialog,['PN-A'],['PN-B','PN-OTHER']);
  await choose(dialog,stationLabel,'M2 · Second');
  await checkParts(dialog,['PN-B'],['PN-A','PN-OTHER']);
  assert.equal(await dialog.getByLabel(/Remove PN-A/).count(),0,'Old product removed');
  await choose(dialog,stationLabel,'M3 · Empty');
  await checkParts(dialog,[],['PN-A','PN-B','PN-OTHER']);
  console.log('PASS actual '+screen+' form: workstation change limits outputs and clears stale products');
 }
 await page.goto('http://127.0.0.1:4193/'+name+'.html?screen=settings');
 await page.getByRole('button',{name:/Create user/i}).click();
 await page.locator('.global-department-choice').getByText('Catalogs',{exact:true}).waitFor();
 await page.locator('.global-department-choice').getByText('Settings',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'System administrator (full access)'}).check();
 console.log('PASS actual Settings form: Catalogs and Settings assignments and full system administrator option');
 assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
