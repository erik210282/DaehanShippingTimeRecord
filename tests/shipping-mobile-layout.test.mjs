import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.shipping-mobile-layout',files=[name+'.html',name+'.jsx'];
fs.writeFileSync(files[0],'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Pending from './src/pages/TareasPendientes';import Summary from './src/pages/Resumen';import Records from './src/pages/Registros';import BOL from './src/pages/GenerarBOL';import i18n from './src/i18n/i18n';import './src/index.css';import './src/App.css';import './src/NativeShipping.css';const params=new URLSearchParams(location.search),kind=params.get('screen'),Component={pending:Pending,summary:Summary,records:Records,bol:BOL}[kind];i18n.changeLanguage(params.get('lang')||'en');if(params.has('nativeShipping'))document.body.classList.add('native-shipping');createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[{pending:'/tareas-pendientes',summary:'/resumen',records:'/registros',bol:'/generarbol'}[kind]]}><div className="app-root"><div className="app-container"><div className="content"><Component/></div></div></div></MemoryRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4188','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture'}});
const activities=['stage','label','scan','load'].map(id=>({id,nombre:id,activo:true}));
const product={id:'part',nombre:'HL MLH',part_number:'1733517-20-E',activo:true};
const completed={id:'record',idx:'IDX 114583',estado:'finalizada',actividad:'load',hora_inicio:'2026-10-19T06:00:00Z',hora_fin:'2026-10-19T07:00:00Z',createdAt:'2026-10-19T06:00:00Z',productos:[{producto:'part',cantidad:30}],operadores:['op'],duracion:60,pausa_total:15,notas:'Inspect labels before loading'};
const capture={actividad_id:'record',etiqueta_inicio:'1234',etiqueta_fin:'5678',trailer:'TRAILER736',trailer_fin:'TRAILER736',puerta:'DOCK 14',puerta_fin:'DOCK 14'};
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4188/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({colorScheme:'dark'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/rest/v1/**',route=>{
  const table=new URL(route.request().url()).pathname.split('/').pop();
  const data=table==='shipping_summary_page'?{activities:[completed],captures:{record:capture},total:1,page:1}:table==='actividades'?activities:table==='productos'?[product]:table==='operadores'?[{id:'op',nombre:'Erik Lopez',activo:true}]:table==='tareas_pendientes'?[{...completed,id:'pending',actividad:'label',estado:'pendiente',prioridad:1}]:table==='actividades_realizadas'?[completed]:table==='shipping_activity_labels'?[capture]:[];
  return route.fulfill({json:data});
 });
 for(const width of [320,390,834]){
  await page.setViewportSize({width,height:844});
  for(const screen of ['pending','summary','records','bol']){
   await page.goto('http://127.0.0.1:4188/'+files[0]+'?nativeShipping=1&screen='+screen);
   await page.locator('.shipping-page h2').waitFor();
   if(screen!=='bol'){
    await page.locator('tbody tr').first().waitFor();
    const geometry=await page.locator('.shipping-table-scroll').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,table:el.querySelector('table').getBoundingClientRect().width,font:parseFloat(getComputedStyle(el.querySelector('td')).fontSize),wrap:getComputedStyle(el.querySelector('th')).whiteSpace}));
    assert.ok(geometry.table>=1400&&geometry.scroll>geometry.width,screen+' keeps readable table widths');
    assert.ok(geometry.font>=14);assert.equal(geometry.wrap,'nowrap');
    await page.locator('.shipping-table-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
    assert.ok(await page.locator('.shipping-table-scroll').evaluate(el=>el.scrollLeft>500),'Table can scroll to its last columns');
    assert.equal(await page.locator('.shipping-table-hint').count(),1);
   }else{
    const fields=await page.locator('.shipping-bol-fields').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,children:[...el.children].map(c=>({x:Math.round(c.getBoundingClientRect().x),right:c.getBoundingClientRect().right}))}));
    assert.equal(fields.columns,1,'BOL uses one vertical column');
    assert.ok(fields.children.every(c=>c.right<=width));
    assert.equal(new Set(fields.children.map(c=>c.x)).size,1,'BOL fields align vertically');
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),screen+' scroll stays inside the table, not the page');
   if(screen!=='bol')await page.locator('.shipping-table-scroll').evaluate(el=>{el.scrollLeft=0;});
   if(width===390)await page.screenshot({path:'/tmp/shipping-'+screen+'-mobile.png',fullPage:true});
  }
 }
 await page.setViewportSize({width:1600,height:900});
 for(const screen of ['pending','summary','records','bol']){
  await page.goto('http://127.0.0.1:4188/'+files[0]+'?screen='+screen);
  await page.locator('.shipping-page h2').waitFor();
  assert.equal(await page.locator('.shipping-table-hint').count(),0,'No mobile helper appears on web');
  if(screen==='bol')assert.equal(await page.locator('.shipping-bol-fields').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),4,'Web BOL retains four columns');
  else assert.equal(await page.locator('table').evaluate(el=>getComputedStyle(el).minWidth),'0px','Desktop table retains its existing compact layout');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: real Shipping pages at 320/390/834 px, normal table widths and horizontal scrolling, BOL vertical fields, page containment, dark-mode readability, desktop layouts unchanged');
}finally{await browser?.close();server.kill();for(const f of files)fs.rmSync(f,{force:true});}
