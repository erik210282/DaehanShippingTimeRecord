import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.production-live-test';
fs.writeFileSync(name+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/'+name+'.jsx"></script></body></html>');
fs.writeFileSync(name+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import ProductionLive from './src/production/ProductionLive';import i18n from './src/i18n/i18n';import {registerProduction} from './src/production/translations';import './src/App.css';import './src/pages/Catalogos.css';import './src/pages/Production.css';i18n.changeLanguage('en');registerProduction(i18n);Modal.setAppElement('#root');createRoot(document.getElementById('root')).render(<ProductionLive supervisor items={[{id:'item',active:true,category:'FG',part_number:'PN-100',part_name:'Test product'}]} stations={[{code:'M-01',name:'Assembly',active:true}]} mode="dashboard"/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4174','--strictPort'],{stdio:'pipe'});
let browser;
try{
 for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4174/'+name+'.html');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const now=Date.now();
 let run={id:'run',station_code:'M-01',item_id:'item',started_at:new Date(now-2*3600000).toISOString(),latest_at:new Date(now).toISOString(),latest_quantity:140,pieces_per_hour:100,interval_hours:2,warning_percent:90,critical_percent:75,expected_quantity:200,attainment:70,performance:'critical',overdue:false};
 let captured;
 await page.route('**/rest/v1/rpc/production_live_*',async route=>{
 const url=route.request().url();
 if(url.endsWith('production_live_snapshot'))return route.fulfill({json:{server_now:new Date().toISOString(),targets:[{item_id:'item',pieces_per_hour:100,interval_hours:2,warning_percent:90,critical_percent:75}],runs:[run],checkpoints:[]}});
 const body=route.request().postDataJSON();captured=body;
 if(body.p_data.quantity==='130')return route.fulfill({status:400,json:{code:'P0001',message:'pl_quantity_invalid',details:null,hint:null}});
 run={...run,latest_quantity:Number(body.p_data.quantity),attainment:90,performance:'warning'};
 return route.fulfill({json:{attainment:90,performance:'warning'}});
 });
 await page.goto('http://127.0.0.1:4174/'+name+'.html');
 await page.getByRole('button',{name:'Record progress',exact:true}).waitFor();
 await page.getByText('70%',{exact:true}).waitFor();
 for(const width of [1280,390]){await page.setViewportSize({width,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.getByRole('button',{name:'Record progress',exact:true}).click();
 const quantity=page.getByLabel('Cumulative produced pieces',{exact:true});
 await quantity.fill('130');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 const popup=page.getByRole('alertdialog');
 await popup.waitFor();
 assert.match(await popup.textContent(),/cannot decrease/);
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
 console.log('PASS: dashboard at desktop/phone widths, checkpoint capture, centered error above form, values retained after error, successful server-time report');
}finally{await browser?.close();server.kill();fs.rmSync(name+'.html',{force:true});fs.rmSync(name+'.jsx',{force:true});}
