import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.bom-existing-test';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import ProductionCatalog from './src/components/ProductionCatalog';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';i18n.changeLanguage('en');Modal.setAppElement('#root');createRoot(document.getElementById('root')).render(<ProductionCatalog mode="bom" hideInactive filter="1586486-81-C" access={{admin:true}}/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4176','--strictPort'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4176/'+name+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const bom={id:'existing-bom',product_part_number:'1586486-81-C',finished_item_id:'fg',version:1,active:false,archived:false,inventory_bom_lines:[],inventory_bom_packaging:[]};
 let saved;
 await page.route('**/rest/v1/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/rpc/inventory_catalog_recipe')){
   saved=route.request().postDataJSON();
   return route.fulfill({json:'existing-bom'});
  }
  const table=url.pathname.split('/').pop();
  const data=table==='inventory_boms'?[bom]:table==='inventory_items'?[{id:'fg',producto_id:1,part_number:bom.product_part_number,part_name:'MS Headliner',category:'FG',uom:'PCS',active:true},{id:'raw',part_number:'RAW-01',part_name:'Foam',category:'RAW',uom:'PCS',active:true}]:table==='productos'?[{id:1,part_number:bom.product_part_number,nombre:'MS Headliner',descripcion:'MSP2. HEADLINER ASY',activo:true}]:[];
  return route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:4176/'+name+'.html');
 const missing=page.locator('.catalog-recipe-notices details').first();
 await missing.getByRole('button',{name:'Edit',exact:true}).waitFor();
 assert.equal(await page.locator('.catalog-bom-table tbody').innerText(),'No results found.');
 await missing.getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.getByLabel('Related product',{exact:true}).inputValue(),bom.product_part_number);
 assert.equal(await page.locator('.catalog-recipe-dialog input[type=checkbox]').isChecked(),false);
 assert.equal(await page.getByLabel('Quantity per finished piece',{exact:true}).count(),1,'Empty imported recipes start with one editable ingredient');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Add',exact:true}).click();
 await page.getByLabel('Related product',{exact:true}).fill(bom.product_part_number);
 await page.getByRole('button',{name:'Edit existing recipe',exact:true}).click();
 await page.getByRole('combobox',{name:'Part',exact:true}).click();
 await page.getByRole('option',{name:'RAW-01 · Foam (PCS)',exact:true}).click();
 await page.getByLabel('Quantity per finished piece',{exact:true}).fill('1');
 await page.getByLabel('Waste (%)',{exact:true}).fill('0');
 await page.locator('.catalog-recipe-dialog input[type=checkbox]').check();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(saved.p_action,'save');
 assert.equal(saved.p_data.id,'existing-bom');
 assert.equal(saved.p_data.active,true);
 assert.deepEqual(saved.p_data.lines,[{ingredient_id:'raw',quantity_per_unit:1,waste_rate:0}]);
 console.log('PASS: inactive empty BOM remains editable with Hide Inactive, duplicate notice opens the existing record, save updates original ID');
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
