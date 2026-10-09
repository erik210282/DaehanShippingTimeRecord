import React,{useCallback,useEffect,useRef,useState} from 'react';
import Modal from 'react-modal';
import {components as selectComponents} from 'react-select';
import {useTranslation} from 'react-i18next';
import {supabase} from '../supabase/client';
import {CatalogInput} from '../components/SharedCatalogFields';
import {DSSelect,BtnPrimary,BtnSecondary,BtnEditDark,BtnDanger} from '../components/controls';
import {ProductionClockInput} from '../components/ProductionCaptureFields';
import ErrorPopup from '../components/ErrorPopup';
import {localStart,localDate,dayRange,liveKpis} from './live.mjs';
import {registerLive} from './liveTranslations';
import i18n from '../i18n/i18n';
registerLive(i18n);
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const red={background:'#dc3545',color:'#fff',borderColor:'#dc3545'};
const modal={overlay:{position:'fixed',inset:0,zIndex:10000,backgroundColor:'#0f172a99',display:'flex',alignItems:'center',justifyContent:'center',padding:16},content:{position:'relative',inset:'auto',width:'min(760px,100%)',maxHeight:'calc(100dvh - 32px)',overflow:'auto',boxSizing:'border-box',border:'1px solid #e2e8f0',borderRadius:16,padding:0,backgroundColor:'#fff',boxShadow:'0 24px 60px rgba(15,23,42,.25)'}};
const selectStyles={control:b=>({...b,minHeight:44,backgroundColor:'#fff',borderColor:'#cbd5e1',boxShadow:'none',borderRadius:8}),singleValue:b=>({...b,color:'#1e293b'}),input:b=>({...b,color:'#1e293b'}),placeholder:b=>({...b,color:'#64748b'}),menu:b=>({...b,backgroundColor:'#fff',color:'#1e293b',borderRadius:8}),option:(b,s)=>({...b,color:'#1e293b',backgroundColor:s.isSelected?'#e2e8f0':s.isFocused?'#f1f5f9':'#fff'}),dropdownIndicator:b=>({...b,color:'#64748b'})};
const LightDropdownIndicator=props=><selectComponents.DropdownIndicator {...props}><span aria-hidden="true" style={{color:'#64748b',fontSize:15,lineHeight:1}}>▾</span></selectComponents.DropdownIndicator>;
function Select({label,value,onChange,options,disabled}){const {t}=useTranslation();return <label className="catalog-field"><span>{label}</span><DSSelect aria-label={label} isDisabled={disabled} styles={selectStyles} components={{DropdownIndicator:LightDropdownIndicator}} options={options} value={options.find(o=>o.value===value)||null} placeholder={t('rc_select')} onChange={o=>onChange(o?.value||'')}/></label>;}
export function LiveLineCard({run,item,station,t,onCapture,onClose,onEdit,onDelete,format=String}){
 const k=liveKpis(run);
 return <article className={'live-line live-'+k.performance}>
 <div className="live-card-heading"><div><h3>{run.station_code} · {station?.name}</h3><p>{item?.part_number} · {item?.part_name}</p></div><span className={'live-badge live-'+k.performance}>{t('pl_status_'+k.performance)}</span></div>
 <div className="live-attainment"><strong>{format(k.attainment)}%</strong><span>{t('pl_attainment')}</span></div>
 <div className="live-progress" role="progressbar" aria-label={t('pl_attainment')} aria-valuenow={Math.min(100,Math.round(k.attainment))} aria-valuemin={0} aria-valuemax={100}><div style={{width:Math.min(100,k.attainment)+'%'}}/></div>
 <dl className="live-card-metrics">{[['quantity',k.quantity],['expected',k.expected],['gap',k.gap],['actual_rate',k.rate]].map(([label,value])=><div key={label}><dt>{t('pl_'+label)}</dt><dd>{format(value)}</dd></div>)}</dl>
 <div className="live-card-meta"><span>{t('pl_shift')}: {run.shift_hours} h · {t('pl_shift_target')}: {format(run.shift_target)}</span><span>{t('pl_last')}: {k.at?new Date(k.at).toLocaleString(i18n.language):'—'}</span><span>{run.closed_at?t('pl_closed'):t('pl_active')}</span></div>
 <div className="live-row-actions">{!run.closed_at&&<><BtnPrimary onClick={onCapture}>{t('pl_capture')}</BtnPrimary><BtnSecondary onClick={onClose}>{t('pl_close_run')}</BtnSecondary></>}<BtnEditDark onClick={onEdit}>{t('edit')}</BtnEditDark><BtnDanger style={red} onClick={onDelete}>{t('delete')}</BtnDanger></div>
 </article>;
}
export default function ProductionLive({items,stations,supervisor,mode='partial'}){
 const {t}=useTranslation(),[snapshot,setSnapshot]=useState({targets:[],runs:[],checkpoints:[]}),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[edit,setEdit]=useState(null),[target,setTarget]=useState(null),[confirmation,setConfirmation]=useState(null),[undo,setUndo]=useState(null),[busy,setBusy]=useState(false),[filter,setFilter]=useState(''),[day,setDay]=useState(localDate());
 const live=useRef(true),lock=useRef(false),seq=useRef(0);
 const refresh=useCallback(async()=>{const range=dayRange(day);if(!range)throw Error('pl_start_invalid');const n=++seq.current;const s=await unwrap(supabase.rpc('production_live_snapshot_range',range));if(live.current&&n===seq.current){setSnapshot(s);setReady(true);}},[day]);
 useEffect(()=>{live.current=true;setReady(false);refresh().catch(e=>live.current&&setError(t(e.message,{defaultValue:t('pr_load_error')})));const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});},15000);const wake=()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});};document.addEventListener('visibilitychange',wake);return()=>{live.current=false;++seq.current;clearInterval(timer);document.removeEventListener('visibilitychange',wake);};},[refresh,t]);
 const format=v=>Number(v||0).toLocaleString(i18n.language,{maximumFractionDigits:1});
 const runs=snapshot.runs.filter(r=>!filter||r.station_code===filter),active=runs.filter(r=>!r.closed_at);
 const reports=snapshot.checkpoints.filter(c=>runs.some(r=>r.id===c.run_id));
 const open=(r,kind='checkpoint')=>setEdit({action:kind,id:crypto.randomUUID(),run_id:r?.id||crypto.randomUUID(),station_code:r?.station_code||'',item_id:r?.item_id||'',date:r?localDate(r.started_at):localDate(),time:r?new Date(r.started_at).toTimeString().slice(0,5):'',quantity:r?String(r.latest_quantity):'',shift_hours:String(r?.shift_hours||8),existing:!!r});
 const reportEdit=c=>setEdit({action:'edit_checkpoint',id:c.id,run_id:c.run_id,quantity:String(c.quantity),recorded_at:c.recorded_at,existing:true});
 const confirm=(action,payload)=>setConfirmation({action,payload});
 async function send(action,payload){if(lock.current)return;lock.current=true;setBusy(true);try{
 const result=await unwrap(supabase.rpc('production_live_action',{p_action:action,p_data:payload}));
 setEdit(null);setTarget(null);setConfirmation(null);
 if(action.startsWith('delete_'))setUndo({action:action.replace('delete_','restore_'),payload});
 else if(action.startsWith('restore_'))setUndo(null);
 if(action==='checkpoint')setNotice(t('pl_saved')+' · '+t('pl_status_'+result.performance)+' · '+format(result.attainment)+'%');
 if(action==='checkpoint'&&day!==localDate())setDay(localDate());
 else await refresh().catch(()=>setError(t('pr_load_error')));
 }catch(e){setError(t(e.message,{defaultValue:t('pr_save_error')}));}finally{lock.current=false;setBusy(false);}}
 function save(e){e.preventDefault();if(edit.action!=='edit_run'&&!/^\d{1,12}$/.test(edit.quantity)){setError(t('pl_quantity_invalid'));return;}
 const started_at=edit.action==='edit_run'||!edit.existing?localStart(edit.date,edit.time):undefined;
 if((edit.action==='edit_run'||!edit.existing)&&!started_at){setError(t('pl_start_invalid'));return;}
 send(edit.action,{...edit,started_at});}
 if(mode==='targets'&&!supervisor)return null;
 return <section className="card live-monitor">
 <header className="live-page-header"><div><p className="live-eyebrow">{t('global_production')}</p><h2>{t(mode==='targets'?'pl_targets':mode==='dashboard'?'pl_dashboard':'pl_partial')}</h2><p className="live-page-description">{t(mode==='targets'?'pl_target_hint':'pl_hint')}</p></div>
 {mode==='targets'?<BtnPrimary disabled={busy} onClick={()=>setTarget({item_id:'',target_8h:'',target_10h:'',warning_percent:'90',critical_percent:'75'})}>＋ {t('add')}</BtnPrimary>:<BtnPrimary disabled={!ready||busy} onClick={()=>open(null)}>＋ {t('pl_new_run')}</BtnPrimary>}</header>
 {undo&&<div className="live-undo" role="status"><span>{t('pl_deleted')}</span><BtnSecondary disabled={busy} onClick={()=>send(undo.action,undo.payload)}>{t('pl_undo')}</BtnSecondary></div>}
 {mode!=='targets'&&<div className="live-filter-bar"><CatalogInput label={t('pl_day')} type="date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/><Select label={t('pr_station')} value={filter} onChange={setFilter} options={[{value:'',label:t('pl_all')},...stations.map(s=>({value:s.code,label:s.code+' · '+s.name}))]}/><BtnSecondary onClick={()=>{setDay(localDate());setFilter('');}}>{t('pl_today')}</BtnSecondary></div>}
 {!ready?<p>{t('loading')}</p>:mode==='targets'?<>
 <div className="table-wrap"><table className="table live-table"><thead><tr>{['inv_part','pl_target8','pl_target10','pl_warning','pl_critical','actions'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{snapshot.targets.map(g=><tr key={g.item_id}><td><strong>{items.find(i=>i.id===g.item_id)?.part_number}</strong><small>{items.find(i=>i.id===g.item_id)?.part_name}</small></td><td>{format(g.target_8h)}</td><td>{format(g.target_10h)}</td><td>{format(g.warning_percent)}%</td><td>{format(g.critical_percent)}%</td><td><div className="live-row-actions"><BtnEditDark onClick={()=>setTarget({...g,existing:true})}>{t('edit')}</BtnEditDark><BtnDanger style={red} onClick={()=>confirm('delete_target',{item_id:g.item_id})}>{t('delete')}</BtnDanger></div></td></tr>)}</tbody></table></div>{!snapshot.targets.length&&<p className="live-empty">{t('pl_no_targets')}</p>}
 </>:<>
 <div className="live-kpi-strip">{[['lines',runs.length],['active',active.length],['alerts',runs.filter(r=>['warning','critical'].includes(liveKpis(r).performance)).length]].map(([label,n])=><div key={label} className={'live-kpi live-kpi-'+label}><span>{t('pl_'+label)}</span><strong>{n}</strong></div>)}</div>
 <p className="live-legend">{t('pl_performance_hint')}</p>
 <div className="live-lines">{runs.map(r=><LiveLineCard key={r.id} run={r} item={items.find(i=>i.id===r.item_id)} station={stations.find(s=>s.code===r.station_code)} t={t} format={format} onCapture={()=>open(r)} onClose={()=>confirm('close',{run_id:r.id})} onEdit={()=>open(r,'edit_run')} onDelete={()=>confirm('delete_run',{run_id:r.id})}/>)}</div>
 {!runs.length&&<p className="live-empty">{t('pl_no_active')}</p>}
 <div className="live-section-heading"><h3>{t('pl_history')}</h3><span>{day} · {reports.length}</span></div>
 <div className="table-wrap"><table className="table live-table"><thead><tr>{['pr_station','inv_part','pl_last','pl_quantity','pl_expected','pl_attainment','status','actions'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{reports.map(c=>{const r=snapshot.runs.find(r=>r.id===c.run_id),performance=liveKpis({...r,attainment:c.attainment,period_at:c.recorded_at}).performance;return <tr key={c.id} className={'live-report-row live-'+performance}><td>{r.station_code}</td><td>{items.find(i=>i.id===r.item_id)?.part_number}</td><td>{new Date(c.recorded_at).toLocaleString(i18n.language)}</td><td>{format(c.quantity)}</td><td>{format(c.expected_quantity)}</td><td><strong>{format(c.attainment)}%</strong></td><td><span className={'live-badge live-'+performance}>{t('pl_status_'+performance)}</span></td><td><div className="live-row-actions"><BtnEditDark onClick={()=>reportEdit(c)}>{t('edit')}</BtnEditDark><BtnDanger style={red} onClick={()=>confirm('delete_checkpoint',{id:c.id})}>{t('delete')}</BtnDanger></div></td></tr>;})}</tbody></table></div>
 {!reports.length&&<p className="live-empty">{t('pl_no_history')}</p>}
 </>}
 <Modal className="live-dialog" isOpen={!!edit||!!target||!!confirmation} onRequestClose={()=>{if(!busy){setEdit(null);setTarget(null);setConfirmation(null);}}} style={modal} contentLabel={t(target?'pl_targets':confirmation?'pl_delete_title':edit?.action==='edit_run'?'pl_edit_run':edit?.action==='edit_checkpoint'?'pl_edit_checkpoint':'pl_partial')}>
 {edit&&<form onSubmit={save}><header className="live-dialog-header"><h2>{t(edit.action==='edit_run'?'pl_edit_run':edit.action==='edit_checkpoint'?'pl_edit_checkpoint':'pl_partial')}</h2><p>{t(edit.action==='edit_checkpoint'?'pl_edit_time_hint':'pl_hint')}</p></header><fieldset disabled={busy} className="live-dialog-body">
 {edit.action!=='edit_checkpoint'&&<><h3>{t('pl_section_details')}</h3><div className="live-form-grid">
 <Select disabled={edit.existing&&edit.action!=='edit_run'} label={t('pr_station')} value={edit.station_code} onChange={station_code=>setEdit({...edit,station_code})} options={stations.filter(s=>s.active||s.code===edit.station_code).map(s=>({value:s.code,label:s.code+' · '+s.name}))}/>
 <Select disabled={edit.existing&&edit.action!=='edit_run'} label={t('inv_part')} value={edit.item_id} onChange={item_id=>setEdit({...edit,item_id})} options={items.filter(i=>i.id===edit.item_id||i.active&&snapshot.targets.some(g=>g.item_id===i.id)).map(i=>({value:i.id,label:i.part_number+' · '+i.part_name}))}/>
 {(!edit.existing||edit.action==='edit_run')&&<><CatalogInput required type="date" label={t('pl_start_date')} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/><ProductionClockInput label={t('pl_start_time')} value={edit.time} onChange={time=>setEdit({...edit,time})}/><Select label={t('pl_shift')} value={edit.shift_hours} onChange={shift_hours=>setEdit({...edit,shift_hours})} options={[8,10].map(n=>({value:String(n),label:t('pl_hours'+n)}))}/></>}
 </div></>}
 {edit.action!=='edit_run'&&<><h3>{t('pl_section_output')}</h3><div className="live-form-grid"><CatalogInput required type="text" inputMode="numeric" pattern="[0-9]{1,12}" label={t('pl_quantity')} value={edit.quantity} onChange={e=>setEdit({...edit,quantity:e.target.value.replace(/\D/g,'').slice(0,12)})}/>{edit.recorded_at&&<p className="live-original-time">{new Date(edit.recorded_at).toLocaleString(i18n.language)}</p>}</div></>}
 </fieldset><footer className="live-dialog-footer"><BtnPrimary style={{background:'#28a745'}} disabled={busy} type="submit">{t(busy?'loading':'save')}</BtnPrimary><BtnDanger style={red} type="button" disabled={busy} onClick={()=>setEdit(null)}>{t('cancel')}</BtnDanger></footer></form>}
 {target&&<form onSubmit={e=>{e.preventDefault();send('target',target);}}><header className="live-dialog-header"><h2>{t('pl_targets')}</h2><p>{t('pl_target_hint')}</p></header><fieldset disabled={busy} className="live-dialog-body"><div className="live-form-grid"><div className="live-field-wide"><Select disabled={target.existing} label={t('inv_part')} value={target.item_id} onChange={item_id=>setTarget({...target,item_id})} options={items.filter(i=>i.active&&['FG','SEMI'].includes(i.category)).map(i=>({value:i.id,label:i.part_number+' · '+i.part_name}))}/></div></div><h3>{t('pl_section_goals')}</h3><div className="live-form-grid">{['target_8h','target_10h'].map(key=><CatalogInput required type="number" step="1" min="1" max="100000000" key={key} label={t(key==='target_8h'?'pl_target8':'pl_target10')} value={target[key]} onChange={e=>setTarget({...target,[key]:e.target.value})}/>)}</div><h3>{t('pl_section_alerts')}</h3><div className="live-form-grid">{['warning_percent','critical_percent'].map(key=><CatalogInput required type="number" step="0.1" min="0.1" max="100" key={key} label={t(key==='warning_percent'?'pl_warning':'pl_critical')} value={target[key]} onChange={e=>setTarget({...target,[key]:e.target.value})}/>)}</div></fieldset><footer className="live-dialog-footer"><BtnPrimary disabled={busy} type="submit">{t('save')}</BtnPrimary><BtnDanger style={red} disabled={busy} type="button" onClick={()=>setTarget(null)}>{t('cancel')}</BtnDanger></footer></form>}
 {confirmation&&<><header className="live-dialog-header"><h2>{t(confirmation.action==='close'?'pl_close_run':'pl_delete_title')}</h2></header><div className="live-dialog-body"><p>{t(confirmation.action==='close'?'pl_close_confirm':'pl_delete_confirm')}</p></div><footer className="live-dialog-footer"><BtnPrimary style={confirmation.action.startsWith('delete_')?red:undefined} disabled={busy} onClick={()=>send(confirmation.action,confirmation.payload)}>{t(confirmation.action==='close'?'pl_close_run':'delete')}</BtnPrimary><BtnDanger style={red} disabled={busy} onClick={()=>setConfirmation(null)}>{t('cancel')}</BtnDanger></footer></>}
 </Modal><ErrorPopup message={error} onClose={()=>setError('')}/><ErrorPopup title={t('pl_saved')} message={notice} onClose={()=>setNotice('')}/>
 </section>;
}
