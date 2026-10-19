import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {groupWorkstationMaterials,expandWorkstationMaterials,validWorkstationMaterials} from '../src/production/workstationMaterials.mjs';
const items=[{id:'fg1',part_number:'PN-001',part_name:'Headliner left',category:'FG',active:true},{id:'fg2',part_number:'PN-002',part_name:'Headliner right',category:'FG',active:true},{id:'raw',part_number:'RAW-001',part_name:'Foam',category:'RAW',active:true}];
let station={code:'M-01',name:'WaterJet machine',machine_type:'WaterJet',active:true,materials:[{erp_material:'SAP-1',product:'TUB',item_id:'fg1',client_part_number:'PN-001',client_part_name:'Headliner left'}]};
const legacy={erp_material:'LEGACY',product:'Imported material',item_id:null,client_part_number:'OLD-PN',client_part_name:'Old name'};
assert.deepEqual(expandWorkstationMaterials(groupWorkstationMaterials([legacy]),items),[legacy],'Retain imported labels without an item link');
const name='.workstation-products-test',files=[name+'.html',name+'.jsx'];
fs.writeFileSync(files[0],'<html><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import Catalog from './src/components/ProductionCatalog';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';i18n.changeLanguage('en');Modal.setAppElement('#root');createRoot(document.getElementById('root')).render(<Catalog mode="stations" access={{admin:true}}/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4187/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/rest/v1/**',async route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  if(table==='inventory_workstations'&&route.request().method()==='PATCH'){
   station={...station,...route.request().postDataJSON()};return route.fulfill({json:[{code:station.code}]});
  }
  return route.fulfill({json:table==='inventory_workstations'?[station]:table==='inventory_items'?items:[]});
 });
 await page.goto('http://127.0.0.1:4187/'+files[0]);
 await page.locator('.catalog-workstations-table').getByRole('button',{name:'Edit',exact:true}).click();
 const selector=page.getByRole('combobox',{name:'Client product (RAW / FG)',exact:true});
 await selector.click();await page.getByRole('option',{name:'PN-002 - Headliner right (FG)',exact:true}).click();
 await selector.click();await page.getByRole('option',{name:'RAW-001 - Foam (RAW)',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.deepEqual(station.materials.map(m=>m.item_id),['fg1','fg2','raw']);
 assert.ok(station.materials.every(m=>m.erp_material==='SAP-1'&&m.product==='TUB'&&!('item_ids' in m)),'Preserve existing stored JSON shape');
 assert.ok(validWorkstationMaterials(station.materials,items));
 assert.ok(!validWorkstationMaterials([...station.materials,station.materials[0]],items),'Reject duplicate code/product pairs');
 const groups=groupWorkstationMaterials(station.materials);assert.equal(groups.length,1);
 assert.deepEqual(expandWorkstationMaterials(groups,items),station.materials,'Saving and reopening retains all product associations');
 await page.locator('.catalog-workstations-table').getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByLabel('Remove PN-002 - Headliner right (FG)',{exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.deepEqual(station.materials.map(m=>m.item_id),['fg1','raw'],'Removing one selection preserves the others');
 assert.deepEqual(errors,[]);
 console.log('PASS: Workstation multiple product selection, existing association preservation, save/reopen, remove one, RAW/FG compatibility and duplicate protection');
}finally{await browser?.close();server.kill();for(const f of files)fs.rmSync(f,{force:true});}
