import Modal from 'react-modal';
import {useShippingForceText} from '../shipping/forceFinish';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {supabase} from '../supabase/client';
import i18n from '../i18n/i18n';
import {BtnPrimary,BtnSecondary,DSInput,DSSelect,TextAreaStyle} from '../components/controls';
import {subscribeUpdates} from '../realtime';
import {operatorApi,activityName,needsLabel,canFinish,phases} from '../shipping/operatorApi.mjs';
import {registerShippingOperator} from '../shipping/operatorTranslations';
import './ShippingOperator.css';
registerShippingOperator(i18n);
const service=operatorApi(supabase),empty={tasks:[],active:[],products:[],catalog:[],operators:[],lines:[],captures:[],person:null};
const colors={stage:'#f580ff',label:'#F1BA8B',scan:'#FFF44F',load:'#B2FBA5',unload:'#AEC6CF'};
export default function ShippingOperator({mode}){
 const f=useShippingForceText(),[canForce,setCanForce]=useState(false),[forceRow,setForceRow]=useState(null),[forceReason,setForceReason]=useState('');
 useEffect(()=>{let active=true;supabase.rpc('shipping_can_force_finish').then(({data,error})=>active&&setCanForce(!error&&data===true));return()=>{active=false;};},[]);
 const {t,i18n}=useTranslation(),[data,setData]=useState(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[drafts,setDrafts]=useState({}),[busy,setBusy]=useState({});const locks=useRef(new Set()),alive=useRef(true),request=useRef(0);
 const refresh=useCallback(async()=>{const id=++request.current;try{const next=await service.load();if(alive.current&&id===request.current){setData(next);setError('');}}catch(e){if(alive.current)setError(t(e.message?.startsWith('so_')?e.message:'so_failed'));}finally{if(alive.current)setLoading(false);}},[t]);
 useEffect(()=>{alive.current=true;refresh();const off=subscribeUpdates(supabase,'shipping-operator',['tareas_pendientes','actividades_realizadas','shipping_activity_labels','shipping_lines','operadores','actividades','productos'],refresh);return()=>{alive.current=false;off();};},[refresh]);
 const change=(id,key,value)=>setDrafts(current=>({...current,[id]:{...current[id],[key]:value}}));
 async function run(row,action){if(locks.current.has(row.id))return;locks.current.add(row.id);setBusy(s=>({...s,[row.id]:true}));setError('');setMessage('');try{await action();await refresh();if(alive.current)setMessage(t('so_saved'));}catch(e){if(alive.current)setError(e.message?.startsWith('so_')?t(e.message):`${t('so_failed')} ${e.message||''}`);}finally{locks.current.delete(row.id);if(alive.current)setBusy(s=>({...s,[row.id]:false}));}}
 const starting=mode==='start',rows=starting?data.tasks.filter(task=>task.estado==='pendiente'&&!data.active.some(a=>a.tarea_id===task.id)):data.active;
 return <main className="so-page module-surface"><div className="so-heading"><h1>{t(starting?'so_start':'so_finish')}</h1><BtnSecondary onClick={refresh} disabled={loading}>{t('so_refresh')}</BtnSecondary></div>
 {error&&<p className="so-error" role="alert">{error}</p>}{message&&<p className="so-success" role="status">{message}</p>}
 {loading?<p>{t('loading')}</p>:!rows.length?<p>{t(starting?'so_empty_start':'so_empty_finish')}</p>:<div className="so-grid">{rows.map(row=>{
 const draft=drafts[row.id]||{},name=activityName(row,data.catalog),isLoad=name==='load',capture=data.captures.find(c=>c.actividad_id===row.id),task=data.tasks.find(task=>task.id===row.tarea_id),instructions=task?.instrucciones_supervisor||task?.notas||row.instrucciones_supervisor||(starting?row.notas:''),disabled=!!busy[row.id],previous=!canFinish(row,data.active,data.catalog);
 const nextName=phases[phases.indexOf(name)+1],nextActivity=phases.includes(name)&&nextName&&data.catalog.find(a=>a.nombre.toLowerCase()===nextName),nextExists=nextActivity&&(data.tasks.some(a=>a.idx===row.idx&&a.actividad===nextActivity.id)||data.active.some(a=>a.idx===row.idx&&a.actividad===nextActivity.id));
 const operatorOptions=data.operators.filter(o=>o.id!==data.person?.id).map(o=>({value:o.id,label:o.nombre}));
 return <article key={row.id} className="so-card" style={{backgroundColor:colors[name]||'#f0f0f0'}}><dl><div><dt>{t('so_code')}</dt><dd>{row.idx}</dd></div><div><dt>{t('so_activity')}</dt><dd>{data.catalog.find(a=>a.id===row.actividad)?.nombre||row.actividad}</dd></div>{!starting&&<><div><dt>{t('status')}</dt><dd>{t(row.estado==='pausada'?'so_paused':'so_started')}</dd></div><div><dt>{t('so_time')}</dt><dd>{new Date(row.hora_inicio).toLocaleString(i18n.language)}</dd></div></>}</dl>
 {(row.es_urgente||task?.es_urgente)&&<strong className="so-badge">{t('so_urgent')}</strong>}{(row.mismo_dia||task?.mismo_dia)&&<strong className="so-badge">{t('so_today')}</strong>}
 <h2>{t('so_products')}</h2>{(row.productos||[]).map((p,index)=>{const product=data.products.find(c=>c.id===p.producto),label=product?.nombre||p.producto;return <div className="so-product" key={`${p.producto}-${index}`}><span>{label}</span>{starting||isLoad||capture?<span>{t('so_quantity')}: {Number(p.cantidad).toLocaleString('en-US')}</span>:<label>{t('so_quantity')}<DSInput aria-label={`${label} ${t('so_quantity')}`} disabled={disabled} inputMode="decimal" value={draft.quantities?.[index]??p.cantidad} onChange={e=>change(row.id,'quantities',{...draft.quantities,[index]:e.target.value.replace(/[^\d.,]/g,'')})}/></label>}</div>;})}
 {instructions&&<div className="so-instructions"><strong>{t('so_instructions')}</strong><p>{instructions}</p></div>}
 <p><strong>{t('so_operator')}: </strong>{starting?data.person?.nombre:(row.operadores||[]).map(id=>data.operators.find(o=>o.id===id)?.nombre||id).join(', ')}</p>
 {starting?<label className="so-field">{t('so_additional')}<DSSelect isMulti isDisabled={disabled} options={operatorOptions} value={operatorOptions.filter(o=>draft.operators?.includes(o.value))} onChange={options=>change(row.id,'operators',(options||[]).map(o=>o.value))} placeholder={t('so_additional')} menuPortalTarget={document.body} styles={{menuPortal:base=>({...base,zIndex:10000})}}/></label>:<label className="so-field">{t('so_notes')}<TextAreaStyle disabled={disabled} value={draft.notes??row.comentario_actividad??row.notas??''} onChange={e=>change(row.id,'notes',e.target.value)}/></label>}
 {isLoad&&<div className="so-fields"><label className="so-field">{t('so_dock')}<div className="so-dock"><span>DOCK</span><DSInput aria-label={t('so_dock')} inputMode="numeric" disabled={disabled} value={draft.dock||''} onChange={e=>change(row.id,'dock',e.target.value.replace(/\D/g,''))}/></div></label><label className="so-field">{t('so_trailer')}<DSInput disabled={disabled} value={draft.trailer||''} onChange={e=>change(row.id,'trailer',e.target.value.toUpperCase())}/></label>{needsLabel(row,data.products)&&<label className="so-field">{t('so_label')}<DSInput disabled={disabled} inputMode="numeric" maxLength={4} value={draft.label||''} onChange={e=>change(row.id,'label',e.target.value.replace(/\D/g,'').slice(0,4))}/></label>}</div>}
 <div className="so-actions">{starting?<BtnPrimary disabled={disabled||!data.person} onClick={()=>run(row,()=>service.begin(row,draft,data))}>{t('so_start')}</BtnPrimary>:<><BtnSecondary disabled={disabled} onClick={()=>run(row,()=>service.pause(row,draft.notes))}>{t(row.estado==='pausada'?'so_resume':'so_pause')}</BtnSecondary><BtnPrimary disabled={disabled||previous||row.estado==='pausada'} onClick={()=>run(row,()=>service.finish(row,draft,data))}>{t('so_finish')}</BtnPrimary>{canForce&&row.tarea_id&&<BtnPrimary disabled={disabled} onClick={()=>{setForceRow(row);setForceReason('');}}>{f('force')}</BtnPrimary>}{nextActivity&&!nextExists&&<BtnSecondary disabled={disabled} onClick={()=>run(row,()=>service.next(row,data))}>{t('so_next')}</BtnSecondary>}</>}</div>{!starting&&previous&&<p>{t('so_previous')}</p>}
 </article>;})}</div>}
 <Modal isOpen={!!forceRow} onRequestClose={()=>forceRow&&!busy[forceRow.id]&&setForceRow(null)} className="modal" overlayClassName="modal-overlay" contentLabel={f('force')}>
  <h2>{f('force')}: {forceRow?.idx}</h2>{error&&<p role="alert">{error}</p>}<p>{f('notice')}</p>
  <label>{f('reason')}<TextAreaStyle maxLength={2000} value={forceReason} onChange={e=>setForceReason(e.target.value)} /></label>
  <div className="so-actions"><BtnSecondary disabled={!!busy[forceRow?.id]} onClick={()=>setForceRow(null)}>{t('cancel')}</BtnSecondary>
  <BtnPrimary disabled={!!busy[forceRow?.id]} onClick={()=>{if(forceReason.trim().length<5){setError(f('required'));return;}const row=forceRow;run(row,async()=>{const {error}=await supabase.rpc('shipping_force_finish_task',{p_tarea:row.tarea_id,p_reason:forceReason.trim()});if(error)throw error;setForceRow(null);});}}>{f('force')}</BtnPrimary></div>
 </Modal></main>;
}
