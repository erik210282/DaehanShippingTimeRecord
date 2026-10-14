import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.inventory-navigation-test';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Inventarios from './src/pages/Inventarios';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';i18n.changeLanguage('en');createRoot(document.getElementById('root')).render(<MemoryRouter><Inventarios access={{admin:true,userId:'test',memberships:[]}}/></MemoryRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4185','--strictPort'],{stdio:'pipe'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4185/'+name+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const items=['A','B','C'].map((p,i)=>({id:p,part_number:'FG-'+p,part_name:['Alpha','Beta','Gamma'][i],description:'Product '+p,category:'FG',uom:'EA',active:true,minimum_quantity:5}));
 await page.route('**/rest/v1/**',route=>{const table=new URL(route.request().url()).pathname.split('/').pop();return route.fulfill({json:table==='inventory_items'?items:table==='inventory_balances'?items.map((p,i)=>({item_id:p.id,area:'FG',quantity:i*100})):[]});});
 await page.goto('http://127.0.0.1:4185/'+name+'.html');
 await page.getByRole('heading',{name:'Inventory Alerts',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Good pieces and quarantine',exact:true}).count(),0);
 assert.deepEqual(await page.locator('.department-nav button').allTextContents(),['Summary','Finished Goods (FG)','Raw Material (RAW)','Work in Process (WIP)','Quality Control','Packaging Material','Confirm Shipments','Inventory Counts','Demand']);
 await page.getByRole('button',{name:'Finished Goods (FG)',exact:true}).click();
 await page.getByRole('cell',{name:'FG-C',exact:true}).waitFor();
 for(const label of ['FG-A · Alpha','FG-B · Beta']){await page.getByRole('combobox',{name:'Part',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();}
 await page.getByRole('button',{name:'Search',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),2);
 await page.getByRole('button',{name:'Clear Filters',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),3);
 await page.getByRole('combobox',{name:'Inventory Status',exact:true}).click();await page.getByRole('option',{name:'Out of Stock',exact:true}).click();
 await page.getByRole('button',{name:'Search',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByRole('button',{name:'Clear Filters',exact:true}).click();
 await page.getByLabel('Search',{exact:true}).fill('Beta');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('cell',{name:'FG-B',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByRole('button',{name:'Confirm Shipments',exact:true}).click();await page.getByLabel('From',{exact:true}).waitFor();await page.getByLabel('To',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: inventory order, Summary alerts, multi-part filtering, search, stock status and shipment date filters');
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
