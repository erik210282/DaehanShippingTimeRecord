import logo from '../assets/Daehan.png';
import {parameterPrintCss,parameterSheet,printRows,productGroups,printChunks} from './parameterPrint.mjs';

export async function createParameterPdf(report,people,{save=true}={}){
 if(!people.facilitator?.trim()||!people.supervisor?.trim()||!['DAY SHIFT','NIGHT SHIFT'].includes(people.shift))throw Error('pp_print_people_required');
 const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas'),import('jspdf')]);
 const frame=document.createElement('iframe');frame.title='Parameter PDF';frame.setAttribute('aria-hidden','true');Object.assign(frame.style,{position:'fixed',left:'-15000px',top:'0',width:'1122px',height:'794px',border:'0'});document.body.appendChild(frame);
 try{
  const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><style>'+parameterPrintCss+'</style></head><body></body></html>');doc.close();
  const pages=[];const rows=printRows(report);if(!rows.length)throw Error('pp_invalid');
  function page(products,batch){const el=doc.createElement('section');el.className='sheet';el.innerHTML=parameterSheet(report,people,products,batch,logo);doc.body.appendChild(el);return el;}
  function fits(el){return el.querySelector('.parameter-table').getBoundingClientRect().bottom<=el.querySelector('.sheet-footer').getBoundingClientRect().top-8;}
  await doc.fonts.ready;
  for(const products of productGroups(report)){
   let batch=[],el=null;
   for(const row of rows){const candidate=[...batch,row];const next=page(products,candidate);if(fits(next)){el?.remove();el=next;batch=candidate;}else{next.remove();if(!batch.length)throw Error('pp_print_layout_error');pages.push(el);batch=[row];el=page(products,batch);if(!fits(el))throw Error('pp_print_layout_error');}}
   if(el)pages.push(el);
  }
  // General notes continue on additional sheets when necessary, without clipping.
  const noteParts=String(report.note||'').trim()?printChunks(report.note,1000):[];
  for(const note of noteParts){const el=page([],[]);el.querySelector('.parameter-table').remove();const notes=doc.createElement('div');notes.style.cssText='border:1px solid #000;min-height:494px;padding:20px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.5';const title=doc.createElement('strong');title.textContent='GENERAL REMARKS\n\n';notes.append(title,doc.createTextNode(note));el.insertBefore(notes,el.querySelector('.sheet-footer'));pages.push(el);}
  const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});pdf.setProperties({title:'Process Parameter Check - '+report.station_code,subject:report.recorded_date,creator:'DAEHAN APP'});
  for(const [index,el] of pages.entries()){
   el.querySelector('.page-number').textContent=`${index+1} / ${pages.length}`;
   await Promise.all([...el.querySelectorAll('img')].map(img=>img.decode()));
   const canvas=await html2canvas(el,{scale:3,backgroundColor:'#ffffff',logging:false,windowWidth:1122,windowHeight:794});if(index)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.97),'JPEG',0,0,297,210,undefined,'FAST');
  }
  const name=('Parameters_'+report.station_code+'_'+report.recorded_date+'_'+String(report.recorded_time||'').slice(0,5).replace(':','')+'.pdf').replace(/[^a-zA-Z0-9_.-]/g,'_');if(save)pdf.save(name);return {pdf,name,pages:pages.length};
 }finally{frame.remove();}
}
