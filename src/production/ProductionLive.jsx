import React,{useCallback,useEffect,useRef,useState} from 'react';
import Modal from 'react-modal';
import {useTranslation} from 'react-i18next';
import {supabase} from '../supabase/client';
import {CatalogInput,CatalogSelect} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary,BtnDanger} from '../components/controls';
import {ProductionClockInput} from '../components/ProductionCaptureFields';
import ErrorPopup from '../components/ErrorPopup';
import {localStart,liveKpis} from './live.mjs';
import {registerLive} from './liveTranslations';
import i18n from '../i18n/i18n';
registerLive(i18n);
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const date=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const modal={overlay:{position:'fixed',inset:0,zIndex:10000,backgroundColor:'#0f172a99',display:'flex',alignItems:'center',justifyContent:'center',padding:16},content:{position:'relative',inset:'auto',width:'min(660px,100%)',maxHeight:'calc(100dvh - 32px)',overflow:'auto',boxSizing:'border-box',borderRadius:14,padding:24}};
export function LiveLineCard({run,item,station,t,onCapture,onClose,format=String}){
 const k=liveKpis(run);
 return <article className={'live-line live-'+(run.performance||'on_track')}>
  <div className="live-card-heading"><div><h3>{run.station_code} · {station?.name}</h3><p>{item?.part_number} · {item?.part_name}</p></div><span className={'live-badge live-'+run.performance}>{t('pl_'+run.performance)}</span></div>
  {run.overdue&&<p className="live-overdue">{t('pl_overdue')}</p>}
  <div className="live-attainment"><strong>{format(k.attainment)}%</strong><span>{t('pl_attainment')}</span></div>
  <div className="live-progress" role="progressbar" aria-label={t('pl_attainment')} aria-valuenow={Math.round(k.attainment)} aria-valuemin={0} aria-valuemax={100}><div style={{width:Math.min(100,k.attainment)+'%'}}/></div>
  <dl className="live-card-metrics">{[['quantity',run.latest_quantity],['expected',k.expected],['gap',k.gap],['actual_rate',k.rate]].map(([label,value])=><div key={label}><dt>{t('pl_'+label)}</dt><dd>{format(value)}</dd></div>)}</dl>
  <p className="inv-muted">{t('pl_rate')}: {format(run.pieces_per_hour)} · {t('pl_last')}: {new Date(run.latest_at).toLocaleString(i18n.language)}</p>
  <p className="inv-muted">{t('pl_due')}: {new Date(k.due).toLocaleString(i18n.language)}</p>
  <div className="catalog-actions"><BtnPrimary onClick={onCapture}>{t('pl_capture')}</BtnPrimary><BtnDanger style={{backgroundColor:'#dc3545',color:'#fff',borderColor:'#dc3545'}} onClick={onClose}>{t('pl_close_run')}</BtnDanger></div>
 </article>;
}
export default function ProductionLive({items,stations,supervisor,mode='partial'}){
 const {t}=useTranslation(),[snapshot,setSnapshot]=useState({targets:[],runs:[],checkpoints:[]}),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[edit,setEdit]=useState(null),[target,setTarget]=useState(null),[closing,setClosing]=useState(null),[busy,setBusy]=useState(false),[filter,setFilter]=useState('');
 const live=useRef(true),lock=useRef(false),seq=useRef(0);
 const refresh=useCallback(async()=>{const n=++seq.current;const s=await unwrap(supabase.rpc('production_live_snapshot'));if(live.current&&n===seq.current){setSnapshot(s);setReady(true);}},[]);
 useEffect(()=>{live.current=true;refresh().catch(e=>live.current&&setError(t(e.message,{defaultValue:t('pr_load_error')})));const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});},15000);const wake=()=>{if(document.visibilityState==='visible')refresh().catch(e=>setError(t(e.message,{defaultValue:t('pr_load_error')})));};document.addEventListener('visibilitychange',wake);return()=>{live.current=false;++seq.current;clearInterval(timer);document.removeEventListener('visibilitychange',wake);};},[refresh,t]);
 const format=v=>Number(v||0).toLocaleString(i18n.language,{maximumFractionDigits:1});
 const active=snapshot.runs.filter(r=>!r.closed_at&&(!filter||r.station_code===filter));
 const open=r=>setEdit({id:crypto.randomUUID(),run_id:r?.id||crypto.randomUUID(),station_code:r?.station_code||'',item_id:r?.item_id||'',date:r?date():date(),time:'',quantity:r?String(r.latest_quantity):'',existing:!!r});
 async function send(action,payload){if(lock.current)return;lock.current=true;setBusy(true);try{
 const result=await unwrap(supabase.rpc('production_live_action',{p_action:action,p_data:payload}));
 setEdit(null);setTarget(null);setClosing(null);
 if(action==='checkpoint')setNotice(t('pl_saved')+' · '+t('pl_'+result.performance)+' · '+format(result.attainment)+'%');
 // A successful save stays successful even if the subsequent refresh loses connectivity.
 await refresh().catch(()=>setError(t('pr_load_error')));
 }catch(e){setError(t(e.message,{defaultValue:t('pr_save_error')}));}finally{lock.current=false;setBusy(false);}}
 function saveCheckpoint(e){e.preventDefault();if(!/^\d{1,12}$/.test(edit.quantity)){setError(t('pl_quantity_invalid'));return;}const started_at=edit.existing?undefined:localStart(edit.date,edit.time);if(!edit.existing&&!started_at){setError(t('pl_start_invalid'));return;}send('checkpoint',{...edit,started_at});}
 if(mode==='targets'&&!supervisor)return null;
 return <section className="card live-monitor">
 <div className="catalog-toolbar"><div><h2>{t(mode==='targets'?'pl_targets':mode==='dashboard'?'pl_dashboard':'pl_partial')}</h2><p className="inv-muted">{t(mode==='targets'?'pl_target_hint':'pl_hint')}</p></div>
 {mode!=='targets'&&<BtnPrimary disabled={!ready||busy} onClick={()=>open(null)}>{t('pl_new_run')}</BtnPrimary>}</div>
 {!ready?<p>{t('loading')}</p>:mode==='targets'?<>
 <BtnPrimary onClick={()=>setTarget({item_id:'',pieces_per_hour:'',interval_hours:'2',warning_percent:'90',critical_percent:'75'})}>{t('add')}</BtnPrimary>
 <div className="table-wrap"><table className="table"><thead><tr>{['inv_part','pl_rate','pl_interval','pl_warning','pl_critical','actions'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{snapshot.targets.map(g=><tr key={g.item_id}><td>{items.find(i=>i.id===g.item_id)?.part_number}</td><td>{format(g.pieces_per_hour)}</td><td>{g.interval_hours}</td><td>{format(g.warning_percent)}%</td><td>{format(g.critical_percent)}%</td><td><BtnSecondary onClick={()=>setTarget({...g})}>{t('edit')}</BtnSecondary></td></tr>)}</tbody></table></div>{!snapshot.targets.length&&<p>{t('pl_no_targets')}</p>}
 </>:<>
 <div className="production-metrics">{[['active',active.length],['alerts',active.filter(r=>r.performance!=='on_track').length],['overdue',active.filter(r=>r.overdue).length]].map(([label,n])=><div key={label}><span>{t('pl_'+label)}</span><strong>{n}</strong></div>)}</div>
 <CatalogSelect label={t('pr_station')} value={filter} onChange={setFilter} options={[{value:'',label:t('pl_all')},...stations.map(s=>({value:s.code,label:s.code+' · '+s.name}))]}/>
 <p className="inv-muted">{t('pl_performance_hint')}</p>
 <div className="live-lines">{active.map(r=><LiveLineCard key={r.id} run={r} item={items.find(i=>i.id===r.item_id)} station={stations.find(s=>s.code===r.station_code)} t={t} format={format} onCapture={()=>open(r)} onClose={()=>setClosing(r)}/>)}</div>
 {!active.length&&<p className="live-empty">{t('pl_no_active')}</p>}
 <h3>{t('pl_history')}</h3><div className="table-wrap"><table className="table"><thead><tr>{['pr_station','inv_part','pl_last','pl_quantity','pl_expected','pl_attainment','status'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{snapshot.checkpoints.filter(c=>{const r=snapshot.runs.find(r=>r.id===c.run_id);return r&&(!filter||r.station_code===filter);}).map(c=>{const r=snapshot.runs.find(r=>r.id===c.run_id);return <tr key={c.id}><td>{r.station_code}</td><td>{items.find(i=>i.id===r.item_id)?.part_number}</td><td>{new Date(c.recorded_at).toLocaleString(i18n.language)}</td><td>{format(c.quantity)}</td><td>{format(c.expected_quantity)}</td><td>{format(c.attainment)}%</td><td>{t('pl_'+c.performance)}{r.closed_at?' · '+t('pl_closed'):''}</td></tr>;})}</tbody></table></div>
 </>}
 <Modal isOpen={!!edit||!!target||!!closing} onRequestClose={()=>{if(!busy){setEdit(null);setTarget(null);setClosing(null);}}} style={modal} contentLabel={t(target?'pl_targets':closing?'pl_close_run':'pl_partial')}>
 {edit&&<form onSubmit={saveCheckpoint}><h2>{t('pl_partial')}</h2><p className="inv-muted">{t('pl_hint')}</p><div className="production-grid">
 <CatalogSelect required disabled={busy||edit.existing} label={t('pr_station')} value={edit.station_code} onChange={station_code=>setEdit({...edit,station_code})} options={stations.filter(s=>s.active&&!snapshot.runs.some(r=>!r.closed_at&&r.station_code===s.code)||s.code===edit.station_code).map(s=>({value:s.code,label:s.code+' · '+s.name}))}/>
 <CatalogSelect required disabled={busy||edit.existing} label={t('inv_part')} value={edit.item_id} onChange={item_id=>setEdit({...edit,item_id})} options={items.filter(i=>i.id===edit.item_id||i.active&&snapshot.targets.some(g=>g.item_id===i.id)).map(i=>({value:i.id,label:i.part_number+' · '+i.part_name}))}/>
 {!edit.existing&&<><CatalogInput required type="date" label={t('pl_start_date')} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/><ProductionClockInput label={t('pl_start_time')} value={edit.time} onChange={time=>setEdit({...edit,time})}/></>}
 <CatalogInput required disabled={busy} type="text" inputMode="numeric" pattern="[0-9]{1,12}" label={t('pl_quantity')} value={edit.quantity} onChange={e=>setEdit({...edit,quantity:e.target.value.replace(/\D/g,'').slice(0,12)})}/>
 </div><p className="inv-muted">{t('pl_only_target')}</p><div className="catalog-actions"><BtnPrimary disabled={busy} type="submit">{t(busy?'loading':'save')}</BtnPrimary><BtnDanger type="button" disabled={busy} onClick={()=>setEdit(null)}>{t('cancel')}</BtnDanger></div></form>}
 {target&&<form onSubmit={e=>{e.preventDefault();send('target',target);}}><h2>{t('pl_targets')}</h2><p className="inv-muted">{t('pl_target_hint')}</p><div className="production-grid"><CatalogSelect required label={t('inv_part')} value={target.item_id} onChange={item_id=>setTarget({...target,item_id})} options={items.filter(i=>i.active&&['FG','SEMI'].includes(i.category)).map(i=>({value:i.id,label:i.part_number+' · '+i.part_name}))}/>{['pieces_per_hour','warning_percent','critical_percent'].map(key=><CatalogInput required type="number" step="0.1" min="0.1" max={key==='pieces_per_hour'?100000000:100} key={key} label={t('pl_'+({pieces_per_hour:'rate',warning_percent:'warning',critical_percent:'critical'}[key]))} value={target[key]} onChange={e=>setTarget({...target,[key]:e.target.value})}/>)}<CatalogSelect label={t('pl_interval')} value={String(target.interval_hours)} onChange={interval_hours=>setTarget({...target,interval_hours})} options={[2,3].map(n=>({value:String(n),label:String(n)}))}/></div><div className="catalog-actions"><BtnPrimary disabled={busy} type="submit">{t('save')}</BtnPrimary><BtnDanger disabled={busy} type="button" onClick={()=>setTarget(null)}>{t('cancel')}</BtnDanger></div></form>}
 {closing&&<><h2>{t('pl_close_run')}</h2><p>{t('pl_close_confirm')}</p><div className="catalog-actions"><BtnPrimary disabled={busy} onClick={()=>send('close',{run_id:closing.id})}>{t('pl_close_run')}</BtnPrimary><BtnDanger disabled={busy} onClick={()=>setClosing(null)}>{t('cancel')}</BtnDanger></div></>}
 </Modal><ErrorPopup message={error} onClose={()=>setError('')}/><ErrorPopup title={t('pl_saved')} message={notice} onClose={()=>setNotice('')}/>
 </section>;
}
