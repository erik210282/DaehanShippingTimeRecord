import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const fixture='.shipping-summary-test';
const files=[fixture+'.html',fixture+'.jsx',fixture+'-page.jsx'];
const source=fs.readFileSync('src/pages/Resumen.jsx','utf8')
 .replace("from '../useLiveVersion'","from './src/useLiveVersion'")
 .replace('import {useLiveVersion}', 'import {useLiveVersion}')
 .replace("import {useLiveVersion} from './src/useLiveVersion';","const useLiveVersion = () => 0;")
 .replace('import { supabase } from "../supabase/client";','const supabase = window.summaryClient;')
 .replaceAll('from "../components/','from "./src/components/')
 .replaceAll('from "../utils/','from "./src/utils/');
fs.writeFileSync(files[0],'<html><body><div id="root"></div><script type="module" src="/'+fixture+'.jsx"></script></body></html>');
fs.writeFileSync(files[2],source);
fs.writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import i18n from 'i18next';import {initReactI18next} from 'react-i18next';
i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{loading:'Loading',buscaridx:'Search IDX',shipping_verified:'Verified',shipping_pending_verification:'Pending'}},es:{translation:{loading:'Cargando',buscaridx:'Buscar IDX'}}}});
window.i18n=i18n;window.requests=[];window.catalogRequests=[];
const capture={etiqueta_inicio:'001234',etiqueta_fin:'005678',trailer:'T',trailer_fin:'T',puerta:'D',puerta_fin:'D'};
window.summaryClient={
from(table){window.catalogRequests.push(table);return {select(){return Promise.resolve({data:table==='actividades'?[{id:'load',nombre:'load'}]:table==='productos'?[{id:'part',nombre:'Widget',part_number:'PN-1'}]:[]});}};},
async rpc(name,args){window.requests.push({name,args});const idx=args.p_idx||String(3000-args.p_page);await new Promise(r=>setTimeout(r,args.p_idx==='slow'?800:80));if(args.p_idx==='error')return {error:{message:'Test failure'}};return {data:{total:60,page:args.p_page,activities:[{id:'a',idx,estado:'finalizada',actividad:'load',hora_inicio:'2026-10-14T06:00:00Z',createdAt:'2026-10-14T06:00:00Z',productos:[{producto:'part',cantidad:10}],operadores:[],duracion:10,pausa_total:0,notas:'Latest note'}],captures:{a:capture}}};}
};
const {default:Resumen}=await import('./${fixture}-page.jsx');
createRoot(document.getElementById('root')).render(<Resumen/>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://summary-fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture-key'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4173/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage();page.on('pageerror',error=>console.error(error));await page.goto('http://127.0.0.1:4173/'+files[0]);
 await page.getByRole('cell',{name:'2999',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.requests.length),1,'One page request even when catalogs settle');
 assert.deepEqual(await page.evaluate(()=>window.catalogRequests.sort()),['actividades','operadores','productos']);
 await page.getByText('✓ Verified',{exact:true}).waitFor();
 assert.match(await page.locator('tbody').innerText(),/1234/);assert.match(await page.locator('tbody').innerText(),/5678/);
 await page.evaluate(()=>window.i18n.changeLanguage('es'));
 await page.getByPlaceholder('Buscar IDX').waitFor();await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>window.requests.length),1,'Language does not redownload history');
 await page.getByRole('button',{name:'2',exact:true}).click();await page.getByRole('cell',{name:'2998',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.requests.at(-1).args.p_page),2);
 const search=page.getByPlaceholder('Buscar IDX');
 await search.fill('s');await search.fill('sl');await search.fill('slow');
 await page.waitForFunction(()=>window.requests.some(r=>r.args.p_idx==='slow'));
 await search.fill('fast');await page.getByRole('cell',{name:'fast',exact:true}).waitFor();await page.waitForTimeout(850);
 assert.equal(await page.getByRole('cell',{name:'slow',exact:true}).count(),0,'Stale response cannot overwrite newer search');
 assert.equal(await page.evaluate(()=>window.requests.filter(r=>['s','sl'].includes(r.args.p_idx)).length),0,'Debounced typing');
 await page.locator('input[type=date]').first().fill('2026-10-14');
 await page.waitForFunction(()=>window.requests.at(-1).args.p_from!==null);
 assert.equal(await page.evaluate(()=>window.requests.at(-1).args.p_page),1);
 await search.fill('error');await page.getByRole('alert').waitFor();await page.waitForFunction(()=>!document.querySelector('[role=status]'));
 assert.match(await page.getByRole('alert').innerText(),/Test failure/);
 console.log('Shipping summary: paged requests, empty catalog, verification, debounce, language, dates and stale responses passed');
}finally{await browser?.close();server.kill();for(const file of files)fs.rmSync(file,{force:true});}
