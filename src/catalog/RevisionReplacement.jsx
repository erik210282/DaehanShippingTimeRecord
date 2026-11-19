import React,{useEffect,useState} from 'react';
import Modal from 'react-modal';
import {useTranslation} from 'react-i18next';
import {supabase} from '../supabase/client';
import {allRows} from '../dataExport.mjs';
import {CatalogSelect,CatalogInput} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary} from '../components/controls';
import {registerRevisionWords} from './revisionWords';
import i18n from '../i18n/i18n';
import './RevisionReplacement.css';
registerRevisionWords(i18n);
const unwrap=async query=>{const {data,error}=await query;if(error)throw error;return data;};
function receipt(result){
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=`Revision_${result.source.part_number}_${result.target.part_number}_${result.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function RevisionReplacement({onClose}){
 const {t,i18n}=useTranslation();
 const [items,setItems]=useState([]),[history,setHistory]=useState([]),[source,setSource]=useState(''),[target,setTarget]=useState('');
 const [preview,setPreview]=useState(null),[selected,setSelected]=useState([]),[result,setResult]=useState(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [request,setRequest]=useState(()=>crypto.randomUUID());
 useEffect(()=>{let live=true;Promise.all([
  allRows(()=>supabase.from('inventory_items').select('id,part_number,part_name,description,category,uom,active').order('part_number')),
  unwrap(supabase.from('catalog_revision_changes').select('id,created_at,result').order('created_at',{ascending:false}).limit(20)),
 ]).then(([rows,changes])=>{if(live){setItems(rows);setHistory(changes);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 function reset(){setPreview(null);setSelected([]);setResult(null);setError('');setRequest(crypto.randomUUID());}
 async function review(){if(busy)return;setBusy(true);setError('');setResult(null);try{
  const data=await unwrap(supabase.rpc('catalog_revision_preview',{p_source:source,p_target:target}));
  setPreview(data);setSelected(data.relations.filter(r=>!r.blockers.length).map(r=>r.key));setRequest(crypto.randomUUID());
 }catch(e){setPreview(null);setError(e.message);}finally{setBusy(false);}}
 async function apply(){if(busy)return;setBusy(true);setError('');try{
  const data=await unwrap(supabase.rpc('catalog_revision_apply',{p_source:source,p_target:target,p_keys:selected,p_token:preview.token,p_request:request,p_note:note}));
  setResult(data);setPreview(data.remaining);setSelected([]);setRequest(crypto.randomUUID());setHistory(rows=>[{id:data.id,created_at:data.applied_at,result:data},...rows.filter(r=>r.id!==data.id)].slice(0,20));
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 const current=items.find(i=>i.id===source),options=rows=>rows.map(i=>({value:i.id,label:`${i.part_number} · ${i.part_name||i.description} · ${i.category} / ${i.uom}`}));
 const blocked=preview?.relations.some(r=>selected.includes(r.key)&&r.blockers.length);
 return <Modal isOpen className="revision-dialog" onRequestClose={()=>!busy&&onClose()} contentLabel={t('cr_title')} style={{overlay:{zIndex:11000,backgroundColor:'rgba(15,23,42,.55)'},content:{inset:'4vh max(12px, calc((100vw - 1100px) / 2))',padding:24,overflow:'auto'}}}>
  <h2>{t('cr_title')}</h2><p>{t('cr_help')}</p>
  <div className="catalog-fields">
   <CatalogSelect label={t('cr_source')} value={source} disabled={busy} onChange={value=>{reset();setSource(value);setTarget('');}} options={options(items)}/>
   <CatalogSelect label={t('cr_target')} value={target} disabled={busy} onChange={value=>{reset();setTarget(value);}} options={options(items.filter(i=>i.active&&i.id!==source&&(!current||i.category===current.category&&String(i.uom).trim().toLowerCase()===String(current.uom).trim().toLowerCase())))}/>
  </div>
  <div className="catalog-actions"><BtnPrimary intent="neutral" disabled={busy||!source||!target} onClick={review}>{t('cr_preview')}</BtnPrimary><BtnSecondary intent="neutral" disabled={busy} onClick={onClose}>{t('close')}</BtnSecondary></div>
  {error&&<p role="alert">{t(error,{defaultValue:t('cr_error')})}</p>}
  <p>{t('cr_preserve')}</p>
  {result&&<div role="status"><strong>{t('cr_done')}</strong><p>{result.changes.length} {t('cr_changes')} · {new Date(result.applied_at).toLocaleString(i18n.language)}</p><BtnSecondary intent="neutral" onClick={()=>receipt(result)}>{t('cr_receipt')}</BtnSecondary></div>}
  {preview&&<>
   <p>{t('cr_stock')}: {preview.stock} {preview.source.uom} · {t('cr_history')}: {Object.values(preview.history).reduce((a,b)=>a+b,0)}</p>
   <h3>{t(result?'cr_remaining':'cr_selected')} ({preview.relations.length})</h3>
   {!!preview.relations.length&&<label className="catalog-checkbox"><input type="checkbox" disabled={busy} checked={preview.relations.some(r=>!r.blockers.length)&&preview.relations.filter(r=>!r.blockers.length).every(r=>selected.includes(r.key))} onChange={e=>setSelected(e.target.checked?preview.relations.filter(r=>!r.blockers.length).map(r=>r.key):[])}/>{t('cr_select_all')}</label>}
   <div className="table-wrap"><table className="table"><thead><tr><th>{t('select')}</th><th>{t('cr_kind')}</th><th>{t('cr_relation')}</th><th>{t('cr_status')}</th></tr></thead><tbody>
    {preview.relations.map(r=><tr key={r.key}><td><input type="checkbox" aria-label={r.label} disabled={busy||!!r.blockers.length} checked={selected.includes(r.key)} onChange={e=>setSelected(values=>e.target.checked?[...values,r.key]:values.filter(k=>k!==r.key))}/></td><td>{t(r.kind==='target'?'cr_target_kind':'cr_'+r.kind)}</td><td>{r.label}</td><td>{r.blockers.length?r.blockers.map(k=><p key={k}>{t(k)}</p>):t('cr_ready')}</td></tr>)}
    {!preview.relations.length&&<tr><td colSpan={4}>{t('cr_none')}</td></tr>}
   </tbody></table></div><p>{t('cr_skip')}</p>
   <CatalogInput label={t('cr_note')} value={note} disabled={busy} maxLength={2000} onChange={e=>setNote(e.target.value)}/>
   <BtnPrimary intent="confirm" disabled={busy||!selected.length||blocked} onClick={apply}>{t('cr_apply')} ({selected.length})</BtnPrimary>
  </>}
  <h3>{t('cr_recent')}</h3><div className="table-wrap"><table className="table"><tbody>{history.map(h=><tr key={h.id}><td>{new Date(h.created_at).toLocaleString(i18n.language)}</td><td>{h.result.source.part_number} → {h.result.target.part_number}</td><td>{h.result.changes.length} {t('cr_changes')}</td><td><BtnSecondary intent="neutral" onClick={()=>receipt(h.result)}>{t('cr_receipt')}</BtnSecondary></td></tr>)}</tbody></table></div>
 </Modal>;
}
