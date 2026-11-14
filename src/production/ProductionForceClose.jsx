import React, {useRef, useState} from 'react';
import Modal from 'react-modal';
import {useTranslation} from 'react-i18next';
import {BtnDanger, BtnSecondary} from '../components/controls';
import {sessionGroups} from './machineCards.mjs';
import {lifecycleSubmission} from './lifecycleEditor.mjs';
import {partLabel} from './supply.mjs';
import {productionRpc} from './commit';

export default function ProductionForceClose({supply, stations, items, onClosed}) {
 const {t}=useTranslation();
 const [visible,setVisible]=useState(false),[selection,setSelection]=useState({id:null,ids:[]});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const lock=useRef(false);
 const runs=supply.data.runs.filter(run=>run.can_force_finish);
 const sessions=sessionGroups(runs);
 const selected=new Set(selection.ids);
 const products=runs.filter(run=>selected.has(run.id)).map(run=>({run_id:run.id,selected:true}));
 const allSelected=runs.length>0&&products.length===runs.length;
 function toggleRuns(rows,checked){
  const ids=new Set(selection.ids);
  for(const run of rows){
   if(checked)ids.add(run.id);
   else ids.delete(run.id);
  }
  setSelection({id:crypto.randomUUID(),ids:[...ids]});
  setError('');
 }
 async function finish(event){
  event.preventDefault();
  if(lock.current||!products.length)return;
  const result=lifecycleSubmission({id:selection.id,action:'force_finish_batch',products});
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
  <BtnDanger intent="danger" disabled={!supply.ready||busy} onClick={()=>{setSelection({id:null,ids:[]});setError('');setSaved(false);setVisible(true);}}>{t('pl_force_finish')}</BtnDanger>
  {saved&&<span role="status">{t('pl_force_saved')}</span>}
  <Modal isOpen={visible} contentLabel={t('pl_force_finish')} onRequestClose={()=>!busy&&setVisible(false)} style={{overlay:{position:'fixed',inset:0,zIndex:11000,backgroundColor:'#0f172a99',display:'flex',alignItems:'center',justifyContent:'center'},content:{position:'relative',inset:'auto',width:'min(560px,92vw)',maxHeight:'90vh'}}}>
   <form onSubmit={finish}>
    <h2>{t('pl_force_finish')}</h2><p>{t('pl_force_hint')}</p>
    {runs.length>0?<BtnSecondary type="button" intent="neutral" disabled={busy} onClick={()=>toggleRuns(runs,!allSelected)}>{t(allSelected?'pl_force_clear_all':'pl_force_select_all')}</BtnSecondary>:<p>{t('pl_force_empty')}</p>}
    {sessions.map(({key,runs:rows})=>{
     const first=rows[0],label=[first.station_code,stations.find(s=>s.code===first.station_code)?.name,new Date(first.started_at).toLocaleString()].filter(Boolean).join(' · ');
     const checked=rows.every(run=>selected.has(run.id)),partial=!checked&&rows.some(run=>selected.has(run.id));
     return <fieldset key={key} style={{marginBlock:12}}>
      <legend><label className="catalog-checkbox">
       <input type="checkbox" disabled={busy} checked={checked} ref={input=>{if(input)input.indeterminate=partial;}} onChange={()=>toggleRuns(rows,!checked)}/>
       {label}
      </label></legend>
      {rows.map(run=><label key={run.id} className="catalog-checkbox" style={{display:'flex',marginBlock:6}}>
       <input type="checkbox" disabled={busy} checked={selected.has(run.id)} onChange={event=>toggleRuns([run],event.target.checked)}/>
       {partLabel(items.find(item=>item.id===run.item_id))||run.item_id} · {run.latest_quantity??0}
      </label>)}
     </fieldset>;
    })}
    {error&&<p role="alert">{t(error,{defaultValue:t('pr_save_error')})}</p>}
    <div className="live-row-actions" style={{marginTop:16}}>
     <BtnDanger intent="danger" type="submit" disabled={busy||!products.length}>{products.length?t('pl_force_finish_selected',{count:products.length}):t('pl_force_finish')}</BtnDanger>
     <BtnSecondary intent="neutral" type="button" disabled={busy} onClick={()=>setVisible(false)}>{t('cancel')}</BtnSecondary>
    </div>
   </form>
  </Modal>
 </div>;
}
