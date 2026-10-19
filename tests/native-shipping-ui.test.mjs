import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const name='.native-shipping-test',files=[name+'.html',name+'.jsx',name+'-gate.jsx',name+'-route.jsx'];
fs.writeFileSync(files[0],'<html><body><div id="root"></div><script type="module" src="/'+files[1]+'"></script></body></html>');
fs.writeFileSync(files[2],fs.readFileSync('src/NativeShippingGate.jsx','utf8').replace("import {supabase} from './supabase/client';","const supabase=window.client;").replace("from './nativeShippingBridge'","from './src/nativeShippingBridge'").replace("import './NativeShipping.css';",""));
fs.writeFileSync(files[3],fs.readFileSync('src/components/ProtectedRoute.jsx','utf8').replace('import { supabase } from "../supabase/client";','const supabase=window.client;'));
fs.writeFileSync(files[1],"import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';import i18n from 'i18next';import {initReactI18next} from 'react-i18next';import {jsPDF} from 'jspdf';\ni18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{loading:'Connecting',ra_denied:'Denied'}},es:{translation:{loading:'Conectando',ra_denied:'Denegado'}}}});\nconst role=new URLSearchParams(location.search).get('role')||'lider';\nwindow.authCalls=[];window.stopCalls=0;\nwindow.client={auth:{\nstopAutoRefresh(){window.stopCalls++;},\nasync setSession(session){window.authCalls.push(session);await new Promise(r=>setTimeout(r,50));return session.access_token==='bad'?{error:{message:'Invalid'}}:{data:{session:{...session,user:{id:'u'}}}};},\nasync getUser(){return {data:{user:{id:'u'}}};},\nasync signOut(){},\nonAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}\n},from(table){const query={select(){return query;},eq(){return query;},maybeSingle(){return Promise.resolve(result());},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};const result=()=>({data:table==='operadores'?{activo:role!=='inactive',role:'operador'}:table==='global_system_admins'?null:role==='outsider'?[]:[{role:role==='inactive'?'lider':role}]});return query;}};\nwindow.ReactNativeWebView={postMessage(raw){const message=JSON.parse(raw);window.bridgeMessages.push(message);if(message.type==='shipping:file')setTimeout(()=>window.dispatchEvent(new CustomEvent('daehan-native',{detail:{type:'shipping:file-result',id:message.id,ok:true}})),20);}};\nwindow.bridgeMessages=[];\nconst {default:Gate}=await import('./.native-shipping-test-gate.jsx');\nconst {default:ProtectedRoute}=await import('./.native-shipping-test-route.jsx');\nconst {saveShippingFile}=await import('./src/nativeShippingBridge');\nwindow.sendSession=access_token=>window.dispatchEvent(new CustomEvent('daehan-native',{detail:{type:'shipping:session',access_token,refresh_token:'refresh',language:'es'}}));\nwindow.downloadPDF=async()=>{const doc=new jsPDF();doc.text('Shipping test',20,20);await saveShippingFile(new Blob([doc.output('arraybuffer')],{type:'application/pdf'}),'BOL.pdf');window.downloaded=true;};\nwindow.downloadCSV=()=>saveShippingFile(new Blob(['IDX,Quantity\\n123,10'],{type:'text/csv;charset=utf-8;'}),'registros.csv');\ncreateRoot(document.getElementById('root')).render(<Gate><MemoryRouter initialEntries={['/secure']}><Routes><Route path=\"/secure\" element={<ProtectedRoute><h1>Shipping Content</h1></ProtectedRoute>}/><Route path=\"/inicio\" element={<h1>No Shipping Access</h1>}/></Routes></MemoryRouter></Gate>);\n");
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4185','--strictPort'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4185/'+files[0])).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Android can deliver the first ready event before its load-start callback.
 // The host then drops the session response while the WebView is still loading.
 await page.goto('http://127.0.0.1:4185/'+files[0]+'?nativeShipping=1');
 await page.waitForFunction(()=>window.bridgeMessages?.some(m=>m.type==='shipping:ready'));
 await page.waitForFunction(()=>window.bridgeMessages.filter(m=>m.type==='shipping:ready').length>=2,{},{timeout:4000});
 await page.evaluate(()=>window.sendSession('recovered-token'));
 await page.getByText('Shipping Content',{exact:true}).waitFor();
 const readyCount=await page.evaluate(()=>window.bridgeMessages.filter(m=>m.type==='shipping:ready').length);
 await page.waitForTimeout(1000);
 assert.equal(await page.evaluate(()=>window.bridgeMessages.filter(m=>m.type==='shipping:ready').length),readyCount,'Stop requesting the session after authentication');
 await page.evaluate(()=>window.sendSession('recovered-token'));
 await page.waitForFunction(()=>window.bridgeMessages.filter(m=>m.type==='shipping:authenticated').length>=2,{},{timeout:2000});
 assert.equal(await page.evaluate(()=>window.authCalls.length),1,'Duplicate delivery must not set the session again');
 // The Android bridge can also appear after the application modules execute.
 await page.route('**/.native-shipping-test.jsx',async route=>{
  const response=await route.fetch();
  const source=(await response.text()).replace('window.ReactNativeWebView={postMessage(raw)', 'window.lateBridge={postMessage(raw)');
  await route.fulfill({response,body:source});
 });
 await page.goto('http://127.0.0.1:4185/'+files[0]+'?nativeShipping=1');
 await page.waitForFunction(()=>window.sendSession);
 assert.equal(await page.getByText('Shipping Content',{exact:true}).count(),0);
 await page.evaluate(()=>{window.ReactNativeWebView=window.lateBridge;});
 await page.waitForFunction(()=>window.bridgeMessages.some(m=>m.type==='shipping:ready'),{},{timeout:4000});
 await page.evaluate(()=>window.sendSession('late-bridge-token'));
 await page.getByText('Shipping Content',{exact:true}).waitFor();
 await page.unroute('**/.native-shipping-test.jsx');
 for(const role of ['lider','supervisor','outsider','inactive']){
  await page.goto('http://127.0.0.1:4185/'+files[0]+'?nativeShipping=1&role='+role);
  await page.waitForFunction(()=>window.bridgeMessages?.some(m=>m.type==='shipping:ready'));
  assert.equal(await page.getByText('Shipping Content',{exact:true}).count(),0,'No page before native authentication');
  await page.evaluate(()=>window.sendSession('token'));
  await page.getByText(['outsider','inactive'].includes(role)?'No Shipping Access':'Shipping Content',{exact:true}).waitFor();
  assert.ok(!page.url().includes('token'));
  assert.ok(await page.evaluate(()=>window.stopCalls>=2));
 }
 await page.goto('http://127.0.0.1:4185/'+files[0]+'?nativeShipping=1');
 await page.waitForFunction(()=>window.bridgeMessages?.some(m=>m.type==='shipping:ready'));
 await page.evaluate(()=>window.sendSession('bad'));await page.getByRole('alert').waitFor();
 assert.equal(await page.getByText('Shipping Content',{exact:true}).count(),0);
 await page.evaluate(()=>window.sendSession('new-token'));await page.getByText('Shipping Content',{exact:true}).waitFor();
 await page.evaluate(()=>window.downloadPDF());
 assert.ok(await page.evaluate(()=>window.downloaded));
 const pdf=await page.evaluate(()=>window.bridgeMessages.find(m=>m.type==='shipping:file'));
 assert.equal(pdf.filename,'BOL.pdf');assert.equal(pdf.mime,'application/pdf');assert.ok(Buffer.from(pdf.base64,'base64').toString().startsWith('%PDF'));
 await page.evaluate(()=>window.downloadCSV());assert.equal(await page.evaluate(()=>window.bridgeMessages.at(-1).filename),'registros.csv');
 assert.deepEqual(errors,[]);
 console.log('PASS: lost initial message, delayed Android bridge, duplicate acknowledgement, native handshake, token-free URL, session failures/recovery, leader/supervisor Shipping access, department/inactive denial, PDF/CSV sharing');
}finally{await browser?.close();server.kill();for(const file of files)fs.rmSync(file,{force:true});}
