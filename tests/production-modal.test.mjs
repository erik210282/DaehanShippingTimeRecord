import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const source=fs.readFileSync('src/pages/Production.jsx','utf8');
const style=source.slice(source.indexOf('const productionModalStyle='),source.indexOf('const tables='));
assert.ok(style.includes("transform:'none'"));
const styles=new Function(style+'return productionModalStyle;')();
const fixture='.production-modal-test';
fs.writeFileSync(fixture+'.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/'+fixture+'.jsx"></script></body></html>');
fs.writeFileSync(fixture+'.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';import Modal from 'react-modal';import './src/pages/Production.css';Modal.setAppElement('#root');const styles=${JSON.stringify(styles)};createRoot(document.getElementById('root')).render(<Modal isOpen style={styles} contentLabel="New production report"><form className="production-form production-dialog"><h2>New production report</h2>{Array.from({length:12},(_,i)=><section className="production-section" key={i}><h3>Section {i+1}</h3><div className="production-form-grid"><label>Station<input/></label><label>Product<input/></label></div></section>)}<footer className="catalog-actions production-dialog-actions"><button type="button">Save draft</button><button type="button">Submit for review</button><button type="button">Cancel</button></footer></form></Modal>);`);
fs.writeFileSync('.bom-layout-test.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/.bom-layout-test.jsx"></script></body></html>');
fs.writeFileSync('.bom-layout-test.jsx',"import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import i18n from 'i18next';import {initReactI18next} from 'react-i18next';import RecipePackingFields from './src/components/RecipePackingFields';import {registerProduction} from './src/production/translations';import './src/pages/Catalogos.css';i18n.use(initReactI18next).init({lng:'en',resources:{en:{translation:{quantity:'Quantity',delete:'Delete',actions:'Actions',inv_part:'Part',cat_waste:'Waste (%)',rc_select:'Select...'}}}});registerProduction(i18n);function Fixture(){const [packing,setPacking]=useState([{packaging_type:'1',box_name:'Expendable',pieces_per_box:7,lines:[{ingredient_id:'box',quantity:1,basis:'box',waste:0}]}]);return <form className=\"catalog-page catalog-dialog catalog-recipe-dialog\" style={{padding:24,maxWidth:1050,margin:'auto'}}><RecipePackingFields packing={packing} setPacking={setPacking} items={[{id:'box',category:'PACKAGING',active:true,part_number:'BOX',part_name:'Cardboard',uom:'PCS'}]}/></form>;}createRoot(document.getElementById('root')).render(<Fixture/>);");
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4173/'+fixture+'.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch();
 const page=await browser.newPage();
 for(const viewport of [{width:1885,height:969},{width:1280,height:720},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:4173/'+fixture+'.html');await page.getByRole('dialog').waitFor();
  const geometry=await page.getByRole('dialog').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scroll:el.scrollHeight,client:el.clientHeight};});
  assert.ok(geometry.x>=15&&geometry.y>=15,JSON.stringify(geometry));
  assert.ok(geometry.x+geometry.width<=viewport.width-15&&geometry.y+geometry.height<=viewport.height-15,JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.x+geometry.width/2-viewport.width/2)<2);
  assert.ok(geometry.scroll>geometry.client);
  await page.getByRole('dialog').evaluate(el=>el.scrollTop=el.scrollHeight);
  const button=await page.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
  assert.ok(button.y>=0&&button.y+button.height<=viewport.height);
 }
 await page.setViewportSize({width:1280,height:720});
 await page.goto('http://127.0.0.1:4173/.bom-layout-test.html');
 await page.getByRole('button',{name:'Add packing material',exact:true}).waitFor();
 const aligned=await page.locator('.recipe-materials-table input[type="number"]').evaluateAll(inputs=>inputs.every(el=>Math.abs(el.getBoundingClientRect().width-el.closest('label').getBoundingClientRect().width)<2));
 assert.ok(aligned,'BOM inputs should fill their label column');
 const add=await page.getByRole('button',{name:'Add packing material',exact:true}).boundingBox();
 const remove=await page.getByRole('button',{name:'Delete packing type',exact:true}).boundingBox();
 assert.ok(remove.x-add.x-add.width>=13,'Packing action buttons must have a visible gap');
 const pieces=await page.getByRole('spinbutton',{name:'Pieces per box',exact:true}).boundingBox();
 const label=await page.locator('.recipe-packing-fields .catalog-field').nth(1).boundingBox();
 assert.ok(Math.abs(pieces.width-label.width)<2,'Pieces per box should fill its grid column');
 console.log('Production modal stays centered, within viewport and scrollable at desktop and phone sizes');
}finally{await browser?.close();server.kill();fs.rmSync(fixture+'.html',{force:true});fs.rmSync(fixture+'.jsx',{force:true});fs.rmSync('.bom-layout-test.html',{force:true});fs.rmSync('.bom-layout-test.jsx',{force:true});}
