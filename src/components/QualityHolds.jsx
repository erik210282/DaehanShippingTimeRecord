import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import { subscribeUpdates, inventoryTables } from '../realtime';
import { unwrap } from '../receiving/api';
import { BtnPrimary, BtnDanger } from './controls';
export default function QualityHolds({items,access}){
 const {t}=useTranslation();
 const [holds,setHolds]=useState([]),[lines,setLines]=useState([]),[receipts,setReceipts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const manage=access.admin||access.memberships.some(m=>m.department==='quality'&&m.role==='supervisor');
 const load=useCallback(async()=>{
  try{
   const [h,l,r]=await Promise.all([unwrap(supabase.from('inventory_quality_holds').select('id,item_id,source_area,quantity,reason,lot,status,created_at,review_note').order('created_at',{ascending:false})),unwrap(supabase.from('receiving_lines').select('id,receipt_id,hold_id')),unwrap(supabase.from('receiving_receipts').select('id,code'))]);
   setHolds(h);setLines(l);setReceipts(r);setError('');
  }catch(e){setError(e.message);}
 },[]);
 useEffect(()=>{load();return subscribeUpdates(supabase,'quality-web',inventoryTables,load);},[load]);
 async function resolve(hold,release){
  if(busy)return;
  if(!window.confirm(t(release?'rc_release':'inv_reject')+': '+(items.find(i=>i.id===hold.item_id)?.part_number||'')))return;
  setBusy(true);
  try{await unwrap(supabase.rpc('inventory_quality_resolve',{p_hold:hold.id,p_release:release,p_note:''}));await load();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <><p>{t('rc_quarantine_help')}</p>{error&&<p role="alert">{error}</p>}<div className="inv-table-wrap"><table><thead><tr>{['inv_part','rc_receipt','rc_quantity','rc_reason','rc_type','actions'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>
 {holds.map(h=><tr key={h.id} style={{background:h.status==='held'?'#fde7e7':undefined}}><td>{items.find(i=>i.id===h.item_id)?.part_number}<small>{items.find(i=>i.id===h.item_id)?.description}</small></td><td>{receipts.find(r=>r.id===lines.find(l=>l.hold_id===h.id)?.receipt_id)?.code||'—'}</td><td>{h.quantity} {items.find(i=>i.id===h.item_id)?.uom}</td><td>{h.reason}</td><td>{t(`rc_${h.status}`)}</td><td>{manage&&h.status==='held'&&<><BtnPrimary disabled={busy} onClick={()=>resolve(h,true)}>{t('rc_release')}</BtnPrimary><BtnDanger disabled={busy} onClick={()=>resolve(h,false)}>{t('inv_reject')}</BtnDanger></>}</td></tr>)}
 </tbody></table></div>{!holds.length&&<p>{t('rc_no_data')}</p>}</>;
}
