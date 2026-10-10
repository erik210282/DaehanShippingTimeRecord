import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.production-live-test';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import ProductionLive from './src/production/ProductionLive';import Production from './src/pages/Production';import {BrowserRouter} from 'react-router-dom';import i18n from './src/i18n/i18n';import {registerProduction} from './src/production/translations';import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';i18n.changeLanguage('en');registerProduction(i18n);Modal.setAppElement('#root');createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('daily')?<BrowserRouter><Production access={{admin:true,userId:'test-user',memberships:[]}}/></BrowserRouter>:<ProductionLive supervisor items={[{id:'item',active:true,category:'FG',part_number:'PN-100',part_name:'Test product'},{id:'item2',active:true,category:'FG',part_number:'PN-200',part_name:'Second product'}]} stations={[{code:'M-01',name:'Assembly',active:true}]} mode={new URLSearchParams(location.search).get("mode")||"dashboard"}/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4174','--strictPort'],{stdio:'pipe'});
let browser;
try{
 for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4174/'+name+'.html');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',error=>console.error('Browser error:',error.message));
 const now=Date.now();
 let run={id:'run',station_code:'M-01',item_id:'item',started_at:new Date(now-2*3600000).toISOString(),latest_at:new Date(now).toISOString(),latest_quantity:140,pieces_per_hour:100,shift_hours:8,shift_target:800,period_quantity:140,period_at:new Date(now).toISOString(),warning_percent:90,critical_percent:75,expected_quantity:200,attainment:70,performance:'critical',overdue:false};
 let captured;

 let dailyCaptured;
 await page.route('**/rest/v1/**',route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  if(table==='production_station_action'){dailyCaptured=route.request().postDataJSON();return route.fulfill({json:'group'});}
  return route.fulfill({json:table==='inventory_items'?[{id:'item',active:true,category:'FG',part_number:'PN-100',part_name:'Test product'},{id:'item2',active:true,category:'FG',part_number:'PN-200',part_name:'Second product'}]:table==='inventory_workstations'?[{code:'M-01',name:'Assembly',active:true}]:[]});
 });

 await page.route('**/rest/v1/rpc/production_live_*',async route=>{
 const url=route.request().url();
 if(url.endsWith('production_live_snapshot_range'))return route.fulfill({json:{server_now:new Date().toISOString(),targets:[{item_id:'item',target_8h:800,target_10h:1200,warning_percent:90,critical_percent:75},{item_id:'item2',target_8h:400,target_10h:500,warning_percent:90,critical_percent:75}],runs:[run],checkpoints:[]}});
 const body=route.request().postDataJSON();captured=body;
 if(body.p_action.endsWith('_batch'))return route.fulfill({json:{saved:true,products:[]}});
 if(body.p_data.quantity==='130')return route.fulfill({status:400,json:{code:'P0001',message:'pl_quantity_invalid',details:null,hint:null}});
 run={...run,latest_quantity:Number(body.p_data.quantity),period_quantity:Number(body.p_data.quantity),attainment:90,performance:'warning'};
 return route.fulfill({json:{attainment:90,performance:'warning'}});
 });
 await page.goto('http://127.0.0.1:4174/'+name+'.html');
 await page.getByRole('button',{name:'Record progress',exact:true}).waitFor();
 await page.getByText('70%',{exact:true}).waitFor();
 assert.equal(await page.locator('.live-line').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 241, 242)');
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();
 const assertSolidDialog=async()=>{assert.equal(await page.locator('.live-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');assert.equal(await page.locator('.live-dialog').evaluate(el=>getComputedStyle(el).opacity),'1');};
 await assertSolidDialog();
 await page.getByRole('combobox',{name:'Reference shift',exact:true}).click();
 const shiftOption=page.getByRole('option',{name:'10 hours',exact:true});await shiftOption.waitFor({state:'visible'});
 assert.equal(await shiftOption.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
 await shiftOption.click();
 assert.equal(await page.locator('.live-dialog [aria-hidden=true]').filter({hasText:'▾'}).first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Delete',exact:true}).first().click();await assertSolidDialog();
 assert.equal(await page.locator('.live-dialog').getByRole('button',{name:'Delete',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(220, 53, 69)');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const date=page.locator('input[type=date]').first();
 const request=page.waitForRequest(req=>req.url().endsWith('production_live_snapshot_range')&&req.postDataJSON().p_from.includes('2026-09-15'));
 await date.fill('2026-09-15');await request;
 await page.getByRole('button',{name:'Today',exact:true}).click();
 for(const width of [1280,390]){await page.setViewportSize({width,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.getByRole('button',{name:'Record progress',exact:true}).click();
 const quantity=page.getByLabel('Cumulative produced pieces',{exact:true});
 await assertSolidDialog();
 await quantity.fill('130');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 const popup=page.getByRole('alertdialog');
 await popup.waitFor();
 assert.match(await popup.textContent(),/cumulative order/);
 assert.equal(await popup.evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;}),true);
 await popup.getByRole('button',{name:'OK',exact:true}).click();
 assert.equal(await quantity.inputValue(),'130');
 await quantity.fill('180');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('alertdialog').waitFor();
 assert.match(await page.getByRole('alertdialog').textContent(),/Progress saved/);
 assert.equal(captured.p_action,'checkpoint');
 assert.equal(captured.p_data.run_id,'run');
 assert.equal(captured.p_data.quantity,'180');
 assert.equal(captured.p_data.started_at,undefined);
 await page.getByRole('alertdialog').getByRole('button',{name:'OK',exact:true}).click();
 await page.getByText('90%',{exact:true}).waitFor();
 await page.goto('http://127.0.0.1:4174/'+name+'.html?mode=targets');
 assert.match(await page.locator('.live-table tbody tr').first().innerText(),/PN-100 · Test product/);
 await page.getByRole('button',{name:/Add/}).click();
 await page.getByLabel('8-hour target (pcs)',{exact:true}).waitFor();await assertSolidDialog();
 await page.getByLabel('10-hour target (pcs)',{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Part',exact:true}).click();
 await page.getByRole('option',{name:'PN-100 · Test product',exact:true}).click();
 assert.equal(await page.locator('.live-dialog input[aria-label="8-hour target (pcs)"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(51, 51, 51)');
 for(const width of [1280,390]){await page.setViewportSize({width,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const boxes=await page.locator('.live-dialog input').evaluateAll(es=>es.map(el=>el.getBoundingClientRect().height));assert.ok(boxes.every(h=>h>=38));}
 assert.equal(await page.getByText('Reporting interval',{exact:true}).count(),0);


 await page.getByRole('combobox',{name:'Part',exact:true}).click();
 await page.getByRole('option',{name:'PN-200 · Second product',exact:true}).click();
 await page.getByLabel('8-hour target (pcs)',{exact:true}).fill('800');
 await page.getByLabel('10-hour target (pcs)',{exact:true}).fill('1000');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('.live-dialog').waitFor({state:'hidden'});
 assert.equal(captured.p_action,'target_batch');
 assert.deepEqual(captured.p_data.products.map(p=>p.item_id),['item','item2']);
 await page.goto('http://127.0.0.1:4174/'+name+'.html?mode=partial');
 await page.getByRole('button',{name:/New machine session/}).click();
 await page.getByRole('combobox',{name:'Workstation',exact:true}).click();
 await page.getByRole('option',{name:'M-01 · Assembly',exact:true}).click();
 for(const label of ['PN-100 · Test product','PN-200 · Second product']){
  await page.getByRole('combobox',{name:'Part',exact:true}).click();
  await page.getByRole('option',{name:label,exact:true}).click();
 }
 await page.getByLabel('Start time',{exact:true}).fill('0000');
 await page.getByLabel('Produced quantity · PN-100',{exact:true}).fill('7');
 await page.getByLabel('Produced quantity · PN-200',{exact:true}).fill('11');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('alertdialog').waitFor();
 assert.equal(captured.p_action,'checkpoint_batch');
 assert.deepEqual(captured.p_data.products.map(p=>[p.item_id,p.quantity]),[['item','7'],['item2','11']]);
 assert.equal(captured.p_data.products[0].session_id,captured.p_data.products[1].session_id);
 assert.notEqual(captured.p_data.products[0].run_id,captured.p_data.products[1].run_id);
 await page.getByRole('alertdialog').getByRole('button',{name:'OK',exact:true}).click();

 run={...run,can_manage:false};
 await page.goto('http://127.0.0.1:4174/'+name+'.html?mode=partial');
 await page.getByText('This station has a session started by another user. Its owner or a supervisor can update it.',{exact:true}).waitFor();
 assert.equal(await page.locator('.live-line').count(),1);
 for(const name of ['Record progress','End session','Edit','Delete'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);

 await page.goto('http://127.0.0.1:4174/'+name+'.html?daily=1&production=records');
 await page.getByRole('button',{name:'Record production',exact:true}).click({timeout:10000}).catch(async error=>{console.error('Daily screen:',await page.locator('body').innerText());throw error;});
 const daily=page.locator('.production-modal');
 await daily.getByRole('combobox').nth(0).click();
 await page.getByRole('option',{name:'M-01 · Assembly',exact:true}).click();
 for(const label of ['PN-100 · Test product','PN-200 · Second product']){
  await daily.getByRole('combobox').nth(1).click();
  await page.getByRole('option',{name:label,exact:true}).click();
 }
 await daily.getByLabel('Start time',{exact:true}).fill('0800');
 await daily.getByLabel('End time',{exact:true}).fill('1600');
 await daily.getByLabel('People at the station',{exact:true}).fill('2');
 await daily.getByLabel('Total machine output (pcs)',{exact:true}).fill('7');
 await daily.getByRole('button',{name:'PN-200',exact:true}).click();
 await daily.getByLabel('Total machine output (pcs)',{exact:true}).fill('11');
 await daily.getByRole('button',{name:'PN-100',exact:true}).click();
 assert.equal(await daily.getByLabel('Total machine output (pcs)',{exact:true}).inputValue(),'7');
 await daily.getByRole('button',{name:'Save draft',exact:true}).click();
 await daily.waitFor({state:'hidden'});
 assert.equal(dailyCaptured.p_action,'save');
 assert.deepEqual(dailyCaptured.p_data.products.map(p=>[p.item_id,p.machine_quantity,p.people]),[['item',7,2],['item2',11,2]]);

 console.log('PASS: opaque edit/delete/capture/target dialogs, visible dropdown arrows, dashboard at desktop/phone widths, checkpoint capture, centered error above form, values retained after error, successful server-time report');
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
