
import assert from 'node:assert/strict';
import fs from 'node:fs';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
const name='.count-flow-test';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import PhysicalCounts from './src/components/PhysicalCounts';import {supabase} from './src/supabase/client';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';i18n.changeLanguage('en');
const items=[{id:'raw',active:true,part_number:'RAW-1',description:'Steel',category:'RAW',uom:'kg',responsible_department:'receiving'},{id:'box',active:true,part_number:'BOX-1',description:'Box',category:'PACKAGING',uom:'EA',responsible_department:'receiving'}];
function App(){const [counts,setCounts]=useState([]);return <PhysicalCounts items={items} balances={[]} counts={counts} access={{admin:true,memberships:[]}} fileRows={async()=>[]} saveCsv={()=>{}} onChanged={async()=>{const {data}=await supabase.from('inventory_counts').select('*');setCounts(data);}}/>;}createRoot(document.getElementById('root')).render(<App/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{stdio:'pipe'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4178/'+name+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('dialog',d=>d.accept());let counts=[],sent,review;
 await page.route('**/rest/v1/**',route=>{
 const table=new URL(route.request().url()).pathname.split('/').pop();
 if(table==='inventory_submit_counts'){sent=route.request().postDataJSON();counts=sent.p_groups.map((g,index)=>({id:'count-'+index,department:g.department,area:g.area,status:'submitted',submitted_at:new Date().toISOString(),inventory_count_lines:g.lines.map(l=>({...l,expected_quantity:0}))}));return route.fulfill({json:counts.map(c=>c.id)});}
 if(table==='inventory_review_counts'){review=route.request().postDataJSON();counts=counts.map(c=>({...c,status:'approved'}));return route.fulfill({json:review.p_counts});}
 return route.fulfill({json:counts});
 });
 await page.goto('http://127.0.0.1:4178/'+name+'.html');
 await page.locator('.count-quantity').fill('10');
 await page.getByRole('combobox',{name:'Area',exact:true}).click();await page.getByRole('option',{name:'Packaging Material',exact:true}).click();
 await page.locator('.count-quantity').fill('25');
 await page.getByRole('combobox',{name:'Area',exact:true}).click();await page.getByRole('option',{name:'Raw Material (RAW)',exact:true}).click();
 await page.getByRole('combobox',{name:'Department',exact:true}).click();await page.getByRole('option',{name:'Receiving',exact:true}).click();
 assert.equal(await page.locator('.count-quantity').inputValue(),'10');
 await page.getByRole('button',{name:'Submit Count to Supervisor',exact:true}).click();
 await page.getByRole('heading',{name:'Approval request · all changes',exact:true}).waitFor();
 assert.equal(sent.p_groups.length,2);
 assert.equal(await page.locator('.count-quantity').inputValue(),'');
 const approve=page.getByRole('button',{name:'Approve and Apply Difference',exact:true});assert.equal(await approve.count(),1);
 await approve.click();await approve.waitFor({state:'hidden'});assert.equal(review.p_counts.length,2);
 console.log('PASS: switching areas/departments retains quantities, one atomic submission clears fields, one supervisor request shows and approves all changes');
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
