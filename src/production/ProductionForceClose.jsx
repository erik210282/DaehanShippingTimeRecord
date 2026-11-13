import React, {useRef, useState} from 'react';
import Modal from 'react-modal';
import {useTranslation} from 'react-i18next';
import {CatalogSelect} from '../components/SharedCatalogFields';
import {BtnDanger, BtnSecondary} from '../components/controls';
import {sessionGroups} from './machineCards.mjs';
import {lifecycleEditor, lifecycleSubmission} from './lifecycleEditor.mjs';
import {partLabel} from './supply.mjs';
import {productionRpc} from './commit';

export default function ProductionForceClose({supply, stations, items, onClosed}) {
 const {t}=useTranslation();
 const [visible,setVisible]=useState(false),[draft,setDraft]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const lock=useRef(false);
 const runs=supply.data.runs.filter(run=>run.can_force_finish);
 const sessions=sessionGroups(runs);
 const options=sessions.map(({key,runs:[run]})=>({value:key,label:[run.station_code,stations.find(s=>s.code===run.station_code)?.name,new Date(run.started_at).toLocaleString()].filter(Boolean).join(' · ')}));
 function selectSession(key){
  const session=sessions.find(row=>row.key===key);
  setDraft(session?{...lifecycleEditor(session.runs[0],runs,()=>crypto.randomUUID(),'force_finish_batch'),key}:null);
  setError('');
 }
 async function finish(event){
  event.preventDefault();
  if(lock.current||!draft)return;
  const result=lifecycleSubmission(draft);
  if(result.error){setError(result.error);return;}
  lock.current=true;
  setBusy(true);
  setError('');
  try{
   const {error:failure}=await productionRpc('production_live_action',{p_action:result.action,p_data:result.payload});
   if(failure)throw failure;
   setVisible(false);
   setSaved(true);
   await Promise.allSettled([supply.refresh(),onClosed()]);
  }catch(failure){setError(failure.message);}finally{lock.current=false;setBusy(false);}
 }
 return <div className="report-actions" style={{marginBottom:12}}>
  <BtnDanger intent="danger" disabled={!supply.ready||busy} onClick={()=>{setDraft(null);setError('');setSaved(false);setVisible(true);}}>{t('pl_force_finish')}</BtnDanger>
  {saved&&<span role="status">{t('pl_force_saved')}</span>}
  <Modal isOpen={visible} contentLabel={t('pl_force_finish')} onRequestClose={()=>!busy&&setVisible(false)} style={{overlay:{position:'fixed',inset:0,zIndex:11000,backgroundColor:'#0f172a99',display:'flex',alignItems:'center',justifyContent:'center'},content:{position:'relative',inset:'auto',width:'min(560px,92vw)',maxHeight:'90vh'}}}>
   <form onSubmit={finish}>
    <h2>{t('pl_force_finish')}</h2><p>{t('pl_force_hint')}</p>
    {options.length?<CatalogSelect label={t('pr_station')} value={draft?.key||''} options={options} onChange={selectSession} disabled={busy}/>:<p>{t('pl_force_empty')}</p>}
    {draft?.products.map(product=><label key={product.run_id} className="catalog-checkbox" style={{display:'flex',marginBlock:8}}>
     <input type="checkbox" disabled={busy} checked={product.selected} onChange={event=>{const selected=event.target.checked;setDraft(current=>({...current,products:current.products.map(row=>row.run_id===product.run_id?{...row,selected}:row)}));}}/>
     {partLabel(items.find(item=>item.id===product.item_id))||product.item_id} · {product.quantity??0}
    </label>)}
    {error&&<p role="alert">{t(error,{defaultValue:t('pr_save_error')})}</p>}
    <div className="live-row-actions" style={{marginTop:16}}>
     <BtnDanger intent="danger" type="submit" disabled={busy||!draft?.products.some(product=>product.selected)}>{t('pl_force_finish')}</BtnDanger>
     <BtnSecondary intent="neutral" type="button" disabled={busy} onClick={()=>setVisible(false)}>{t('cancel')}</BtnSecondary>
    </div>
   </form>
  </Modal>
 </div>;
}
