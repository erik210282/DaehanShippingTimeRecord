import React,{useState,useRef} from 'react';
import Modal from 'react-modal';
import {useTranslation} from 'react-i18next';
import {CatalogInput} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary,BtnDanger} from '../components/controls';
import {supabase} from '../supabase/client';
import {notifyUpdates} from '../realtime';
import {partLabel} from './supply.mjs';
export default function MaterialLoadHistory({selection,loads,items,refresh,onClose,onError}){
 const {t}=useTranslation(),[values,setValues]=useState({}),[busy,setBusy]=useState(false),lock=useRef(false);
 const rows=selection?loads.filter(l=>l.station_code===selection.station_code&&l.item_id===selection.item_id):[];
 async function save(row,action){
  if(lock.current||action==='delete'&&!window.confirm(t('ps_delete_load_confirm')))return;
  const quantity=values[row.id]??String(row.quantity);
  if(action==='edit'&&(!Number.isFinite(Number(quantity))||Number(quantity)<=0||Number(quantity)>1000000000)){onError('ps_load_invalid');return;}
  lock.current=true;setBusy(true);
  try{const {error}=await supabase.rpc('production_material_load_action',{p_action:action,p_data:{id:row.id,version:row.updated_at||row.created_at,quantity}});if(error)throw error;notifyUpdates(supabase);await refresh();setValues(v=>{const next={...v};delete next[row.id];return next;});}
  catch(e){onError(e.message);await refresh().catch(()=>{});}finally{lock.current=false;setBusy(false);}
 }
 return <Modal portalClassName="production-report-portal" isOpen={!!selection} onRequestClose={()=>!busy&&onClose()} contentLabel={t('ps_history')} style={{overlay:{zIndex:11000,background:'#0f172a99',display:'flex',alignItems:'center',justifyContent:'center',padding:16},content:{position:'relative',inset:'auto',width:'min(760px,100%)',maxHeight:'90dvh',overflow:'auto',borderRadius:14}}}>
 <h2>{t('ps_history')}</h2><p>{selection?.station_code} · {partLabel(items.find(i=>i.id===selection?.item_id))}</p>
 {rows.map(row=><section className="card" key={row.id}><p>{new Date(row.created_at).toLocaleString()} · {row.reporter_name||'—'}</p><CatalogInput label={t('ps_quantity')} type="number" min="0.000001" max="1000000000" step="any" disabled={busy||selection?.action==='delete'} value={values[row.id]??String(row.quantity)} onChange={e=>setValues(v=>({...v,[row.id]:e.target.value}))}/><div className="report-row-actions">{selection?.action!=='delete'&&<BtnPrimary intent="confirm" disabled={busy} onClick={()=>save(row,'edit')}>{t('save')}</BtnPrimary>}<BtnDanger intent="danger" disabled={busy} onClick={()=>save(row,'delete')}>{t('delete')}</BtnDanger></div></section>)}
 {!rows.length&&<p>{t('ps_no_materials')}</p>}<BtnSecondary intent="neutral" disabled={busy} onClick={onClose}>{t('pp_close')}</BtnSecondary>
 </Modal>;
}
