import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const files=['.floor-ui.html','.floor-ui.jsx'];
const items=['a','b','c'].map((id,index)=>({id,active:true,category:'RAW',part_number:'RAW-'+id.toUpperCase(),part_name:'Material '+id.toUpperCase(),uom:['kg','gal','lb'][index]}));
const stations=[{code:'M1',name:'Foaming',active:true},{code:'M2',name:'Assembly',active:true},{code:'M3',name:'Unassigned',active:true}];
fs.writeFileSync(files[0],'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import Supply,{ProductionSupplyAlerts} from './src/production/ProductionSupply';import i18n from './src/i18n/i18n';import {registerProduction} from './src/production/translations';registerProduction(i18n);import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';i18n.changeLanguage(new URLSearchParams(location.search).get('lang')||'en');Modal.setAppElement('#root');const params=new URLSearchParams(location.search);function Alerts(){const [low,setLow]=React.useState(true);window.setLow=setLow;return <ProductionSupplyAlerts enabled={params.get('role')!=='operator'} items={${JSON.stringify(items)}} rows={[{station_code:'M1',item_id:'a',minutes:15,low}]}/>;}createRoot(document.getElementById('root')).render(params.has('alerts')?<Alerts/>:<Supply items={${JSON.stringify(items)}} stations={${JSON.stringify(stations)}} manage mode="materials"/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4191','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4191/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let saved;
 await page.route('**/rest/v1/**',route=>{
  const rpc=new URL(route.request().url()).pathname.split('/').pop();
  if(rpc==='production_supply_action'){saved=route.request().postDataJSON();return route.fulfill({json:{saved:true}});}
  return route.fulfill({json:rpc==='production_supply_snapshot'?{station_materials:[{station_code:'M1',item_id:'a'},{station_code:'M1',item_id:'b'},{station_code:'M2',item_id:'b'}],runs:[],materials:[],loads:[],wip:[],baselines:[]}:[]});
 });
 async function choose(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4191/'+files[0]);
  await page.getByRole('button',{name:'Load / replenish material',exact:true}).first().click();const dialog=page.getByRole('dialog').first();
  await choose('Workstation','M1 · Foaming');
  const a=dialog.getByRole('spinbutton',{name:'Loaded quantity · RAW-A · Material A (kg)',exact:true}),b=dialog.getByRole('spinbutton',{name:'Loaded quantity · RAW-B · Material B (gal)',exact:true});
  await a.fill('12.5');await b.fill('34');assert.equal(await dialog.getByRole('spinbutton').count(),2);
  assert.equal(await dialog.getByText('Alert lead time (minutes)',{exact:true}).count(),0);await dialog.getByText(/A pop-up alerts the leader/).waitFor();
  await dialog.getByRole('combobox',{name:'Part',exact:true}).click();assert.equal(await page.getByRole('option',{name:/RAW-C/}).count(),0);await dialog.getByRole('heading',{name:'Load / replenish material',exact:true}).click();
  const selection=dialog.locator('label.catalog-field').filter({has:page.getByRole('combobox',{name:'Part',exact:true})});
  await selection.getByLabel('Remove RAW-A · Material A · kg',{exact:true}).click();assert.equal(await a.count(),0);assert.equal(await b.inputValue(),'34');
  await choose('Part','RAW-A · Material A · kg');await a.fill('12.5');assert.equal(await b.inputValue(),'34');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(saved.p_action,'load-batch');assert.deepEqual(saved.p_data.entries.map(e=>[e.item_id,e.quantity,e.alert_minutes]),[['b','34',15],['a','12.5',15]]);
  await page.getByRole('button',{name:'Load / replenish material',exact:true}).first().click();await choose('Workstation','M2 · Assembly');assert.equal(await dialog.getByRole('spinbutton').count(),1);await choose('Workstation','M3 · Unassigned');assert.equal(await dialog.getByRole('spinbutton').count(),0);await dialog.getByText(/This workstation has no linked RAW/).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS visible per-material quantities, independent edits/payload, restricted RAW and no alert input at '+width+'px');
 }
 for(const lang of ['es','ko']){
  await page.goto('http://127.0.0.1:4191/'+files[0]+'?lang='+lang);await page.locator('.live-page-header button').click();const dialog=page.getByRole('dialog').first();await dialog.getByRole('combobox').first().click();await page.getByRole('option',{name:'M1 · Foaming',exact:true}).click();assert.equal(await dialog.getByRole('spinbutton').count(),2);assert.ok((await dialog.textContent()).includes('15'));assert.equal((await dialog.textContent()).includes('ps_'),false);
 }
 for(const role of ['leader','supervisor','operator']){
  await page.goto('http://127.0.0.1:4191/'+files[0]+'?alerts&role='+role);const popup=page.getByRole('dialog');
  if(role==='operator'){await page.waitForTimeout(150);assert.equal(await popup.count(),0);continue;}
  await popup.getByText(/M1/).waitFor();await popup.getByRole('button').click();assert.equal(await popup.count(),0);
  await page.evaluate(()=>window.setLow(false));await page.waitForTimeout(50);await page.evaluate(()=>window.setLow(true));await popup.getByText(/M1/).waitFor();
 }
 console.log('PASS 15-minute pop-up enabled for leaders/supervisors, acknowledgement/reset and operator suppression');
 assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();for(const f of files)fs.rmSync(f,{force:true});}
