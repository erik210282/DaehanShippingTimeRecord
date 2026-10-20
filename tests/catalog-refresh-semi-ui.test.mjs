import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.catalog-refresh-semi';
fs.writeFileSync(name+'.html','<html><body><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Modal from 'react-modal';import Catalogos from './src/pages/Catalogos';import i18n from './src/i18n/i18n';import './src/App.css';import './src/pages/Catalogos.css';i18n.changeLanguage('en');Modal.setAppElement('#root');createRoot(document.getElementById('root')).render(<MemoryRouter><Catalogos access={{admin:true}}/></MemoryRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4193','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});let browser;
try {
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4193/'+name+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage();const errors=[],saved=[];page.on('pageerror',e=>errors.push(e.message));let reads=0,delay=false;
 const types=['RAW','SEMI','FG'].map(code=>({code,name:code,category:code,active:true,builtin:true}));
 const stock=[{id:'semi-1',part_number:'SEMI-01',part_name:'Formed panel',description:'Intermediate panel',category:'SEMI',uom:'EA',active:true,minimum_quantity:0,responsible_department:'production'}];
 await page.route('**/rest/v1/**',async route=>{
 const table=new URL(route.request().url()).pathname.split('/').pop();
 if(table==='shared_catalog'){saved.push(route.request().postDataJSON());return route.fulfill({json:'created'});}
 if(table==='inventory_items'){reads++;if(delay)await new Promise(r=>setTimeout(r,400));}
 return route.fulfill({json:table==='inventory_items'?stock:table==='receiving_material_types'?types:[]});
 });
 await page.goto('http://127.0.0.1:4193/'+name+'.html');await page.getByRole('cell',{name:'SEMI-01',exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Type',exact:true}).click();await page.getByRole('option',{name:'Semi-finished product (SEMI)',exact:true}).click();
 await page.evaluate(()=>{window.keptRow=document.querySelector('tbody tr');});
 delay=true;const before=reads;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>window.keptRow?.isConnected);await page.waitForTimeout(250);
 assert.ok(reads>before);assert.equal(await page.evaluate(()=>window.keptRow===document.querySelector('tbody tr')),true,'Background refresh must not unmount rows');
 await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.keptRow===document.querySelector('tbody tr')),true);
 await page.getByRole('button',{name:/Add/,exact:false}).first().click();
 await page.getByRole('combobox',{name:'Type',exact:true}).last().click();await page.getByRole('option',{name:'Semi-finished product (SEMI)',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Part Number',{exact:true}).fill('SEMI-02');await dialog.getByLabel('Name',{exact:true}).fill('Turntable panel');
 await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(saved[0].p_data.material_type,'SEMI');assert.equal(saved[0].p_data.responsible_department,'production');assert.equal(saved[0].p_data.part_name,'Turntable panel');
 assert.deepEqual(errors,[]);console.log('PASS: SEMI catalog filtering and creation, production ownership and quiet background updates retaining rows');
}finally{await browser?.close();server.kill();for(const suffix of ['.html','.jsx'])fs.rmSync(name+suffix,{force:true});}
