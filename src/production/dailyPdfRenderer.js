import {dailyPrintModel} from './dailyPrint.mjs';
import {createDailyPdf} from './dailyPdf';

export function startDailyPdfRenderer() {
 const native = window.ReactNativeWebView;
 const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
 const send = message => {
  if (native) native.postMessage(JSON.stringify(message));
  else if(parentOrigin) window.parent.postMessage(message, parentOrigin);
 };
 let busy = false;
 window.addEventListener('message', async event => {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  await generate(event.data);
 });
 window.addEventListener('daehan-daily-pdf', event => {
  if (native) void generate(event.detail);
 });

 async function generate(request) {
  if (busy || request?.type !== 'daily-pdf:generate') return;
  busy = true;
  try {
   const model = dailyPrintModel(request.context);
   const {pdf,name} = await createDailyPdf(model,request.people,{save:false});
   send({type:'daily-pdf:file',filename:name,base64:pdf.output('datauristring').split(',')[1]});
  } catch (error) {
   send({type:'daily-pdf:error',error:error.message?.startsWith('dt_')?error.message:'dt_pdf_error'});
  } finally {
   busy = false;
  }
 }
 send({type:'daily-pdf:ready'});
}
