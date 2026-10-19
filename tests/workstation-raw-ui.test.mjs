import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {productionExport} from '../src/catalog/productionExport.mjs';
const items=[{id:'fg',part_number:'FG-001',part_name:'Headliner',category:'FG',active:true,uom:'EA'},{id:'raw1',part_number:'RAW-001',part_name:'Foam',category:'RAW',active:true,uom:'kg'},{id:'raw2',part_number:'RAW-002',part_name:'Release agent',category:'RAW',active:true,uom:'gal'},{id:'off',part_number:'RAW-OFF',part_name:'Inactive material',category:'RAW',active:false,uom:'kg'},{id:'packing',part_number:'BOX-001',part_name:'Box',category:'PACKAGING',active:true,uom:'EA'}];
let station={code:'M-01',name:'Foaming machine',machine_type:'Foaming',active:true,raw_material_ids:[],materials:[{erp_material:'SAP-1',product:'TUB',item_id:'fg',client_part_number:'FG-001',client_part_name:'Headliner'}]};
const original=JSON.stringify(station.materials),files=['.station-raw-ui.html','.station-raw-ui.jsx'];
fs.writeFileSync(files[0],'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import Catalog from './src/components/ProductionCatalog';import Supply from './src/production/ProductionSupply';import {supabase} from './src/supabase/client';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';i18n.changeLanguage(new URLSearchParams(location.search).get('lang')||'en');Modal.setAppElement('#root');function Load(){const [stations,setStations]=React.useState([]);React.useEffect(()=>{supabase.from('inventory_workstations').select('*').then(({data})=>setStations(data||[]));},[]);return <Supply items={${JSON.stringify(items)}} stations={stations} manage mode="materials"/>;}createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('load')?<Load/>:<Catalog mode="stations" access={{admin:true}}/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4193','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4193/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/rest/v1/**',route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  if(table==='inventory_workstations'&&route.request().method()==='PATCH'){station={...station,...route.request().postDataJSON()};return route.fulfill({json:[{code:station.code}]});}
  return route.fulfill({json:table==='inventory_workstations'?[station]:table==='inventory_items'?items:table==='production_supply_snapshot'?{station_materials:station.raw_material_ids.map(item_id=>({station_code:station.code,item_id})),materials:[],runs:[],loads:[],wip:[],baselines:[]}:[]});
 });
 page.setDefaultTimeout(10000);
 const base='http://127.0.0.1:4193/'+files[0];
 await page.goto(base);const table=page.locator('.catalog-workstations-table');await table.waitFor();await table.getByRole('columnheader',{name:'RAW Materials',exact:true}).waitFor();await table.getByText('No RAW materials assigned',{exact:true}).waitFor();
 await table.getByRole('button',{name:'Edit',exact:true}).click();const dialog=page.getByRole('dialog'),raw=dialog.getByRole('combobox',{name:'RAW Materials',exact:true});
 await raw.click();assert.equal(await page.getByRole('option',{name:/FG-001|BOX-001|RAW-OFF/}).count(),0);await page.getByRole('option',{name:'RAW-001 - Foam · kg',exact:true}).click();await raw.click();await page.getByRole('option',{name:'RAW-002 - Release agent · gal',exact:true}).click();
 await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(station.raw_material_ids,['raw1','raw2']);assert.equal(JSON.stringify(station.materials),original,'RAW edits do not change output products/ERP associations');
 await table.getByRole('cell').filter({hasText:'RAW-001'}).getByText('Foam',{exact:true}).waitFor();
 const csv=productionExport({stations:true,rows:[station],items,t:k=>k});assert.ok(csv.fields.includes('dt_raw_materials'));assert.equal(csv.data[0][4],'RAW-001 - Foam / RAW-002 - Release agent');
 await table.getByRole('button',{name:'Duplicate',exact:true}).click();await dialog.getByLabel('Remove RAW-001 - Foam · kg',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Code',{exact:true}).inputValue(),'');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await table.getByRole('button',{name:'Edit',exact:true}).click();await dialog.getByLabel('Remove RAW-002 - Release agent · gal',{exact:true}).click();await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(station.raw_material_ids,['raw1']);
 await page.goto(base+'?load');await page.locator('.live-page-header button').click();await dialog.getByRole('combobox',{name:'Workstation',exact:true}).click();await page.getByRole('option',{name:'M-01 · Foaming machine',exact:true}).click();await dialog.getByRole('spinbutton',{name:'Loaded quantity · RAW-001 · Foam (kg)',exact:true}).waitFor();await dialog.getByRole('combobox',{name:'Part',exact:true}).click();assert.equal(await page.getByRole('option',{name:/RAW-002|FG-001/}).count(),0);
 for(const [lang,label] of [['es','Materiales RAW'],['ko','원자재 (RAW)']]){await page.goto(base+'?lang='+lang);await table.getByRole('columnheader',{name:label,exact:true}).waitFor();await table.locator('tbody button').first().click();await dialog.getByRole('combobox',{name:label,exact:true}).waitFor();assert.equal((await dialog.innerText()).includes('dt_raw_'),false);}
 assert.deepEqual(errors,[]);console.log('PASS independent RAW catalog column/editor, RAW-only PN/name options, save/reopen/remove, duplicate, CSV, workstation load filtering and ES/EN/KO');
}finally{await browser?.close();server.kill();for(const f of files)fs.rmSync(f,{force:true});}
