import { usePageSection } from '../usePageSection';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import i18n from '../i18n/i18n';
import { BtnPrimary, BtnSecondary, BtnDanger, PillInput, DSSelect } from '../components/controls';
import { api, emptyData, newId, number, quantity, activeTask, allowedLocations, receiptState, statusColors, itemLabel, locationLabel, finishLines, effectiveSeconds, productivity, localDay } from '../receiving/api';
import { registerReceiving, receivingError } from '../receiving/translations';
import DepartmentNav from '../components/DepartmentNav';
import './Receiving.css';
import Catalogos from './Catalogos';
import { subscribeUpdates, receivingTables } from '../realtime';
registerReceiving(i18n);
const service = api(supabase);
const blankLine = () => ({ item_id: '', expected: '', category: 'RAW' });
const blankReceipt = () => ({ supplier_id: '', manifest: '', po_number: '', dock: '', trailer: '', lines: [blankLine()] });

function SelectField({ label, value, onChange, options, multi = false, disabled = false }) {
  const { t } = useTranslation();
  return <label className="rc-field"><span>{label}</span><DSSelect aria-label={label} isMulti={multi} isDisabled={disabled}
    styles={{menuPortal:base=>({...base,zIndex:10002})}} placeholder={t('rc_select')} options={options} value={multi ? options.filter(o => value.includes(o.value)) : options.find(o => o.value === value) || null}
    onChange={option => onChange(multi ? (option || []).map(o => o.value) : option?.value || '')} /></label>;
}
function Field({ label, value, onChange, type = 'text', ...props }) {
  return <label className="rc-field"><span>{label}</span><PillInput type={type} value={value} onChange={e => onChange(e.target.value)} {...props} /></label>;
}

export default function Receiving({ access }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(emptyData), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [ready,setReady]=useState(false);
  const [tab, setTab] = usePageSection('receiving', 'pending', ['pending','summary','productivity','catalogs']), [from, setFrom] = useState(''), [to, setTo] = useState(''), [filter, setFilter] = useState(''), [search, setSearch] = useState('');
  const [newReceipt, setNewReceipt] = useState(false), [receiptDraft, setReceiptDraft] = useState(blankReceipt), [selected, setSelected] = useState('');
  const [finishTask, setFinishTask] = useState(null), [actual, setActual] = useState({});
  const [putLine, setPutLine] = useState(null), [putLocation, setPutLocation] = useState(''), [putQuantity, setPutQuantity] = useState('');
  const [holdLine, setHoldLine] = useState(null), [reason, setReason] = useState('');
  const [additional,setAdditional]=useState([]),[putAdditional,setPutAdditional]=useState([]);
  const lock = useRef(false), receiptId = useRef(null), putId = useRef(null);
  const receiver = access.admin || access.memberships.some(m => m.department === 'receiving');
  const qualityAccess = access.memberships.some(m => m.department === 'quality');
  const allowed = receiver || qualityAccess;
  const manage = access.admin || access.memberships.some(m => m.department === 'receiving' && ['supervisor','lider'].includes(m.role));
  const supervisor = access.admin || access.memberships.some(m => m.department === 'receiving' && m.role === 'supervisor');
  const fmt = value => number(value).toLocaleString(i18n.language, { maximumFractionDigits: 2 });
  const date = value => value ? new Date(value).toLocaleString(i18n.language) : '—';
  const refresh = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    try { setData(await service.load()); setReady(true); setError(''); } catch (failure) { console.error('Receiving load failed', failure.code, failure.message); setError(t('rc_load_error')); } finally { setLoading(false); }
  }, [allowed,t]);
  useEffect(() => { refresh();return subscribeUpdates(supabase,'receiving-web',receivingTables,refresh); }, [refresh]);
  async function run(action) {
    if (lock.current) return; lock.current=true; setBusy(true); setMessage(''); setError('');
    try { await action(); setMessage(t('rc_saved')); await refresh(); }
    catch (e) { setError(receivingError(e,t)); }
    finally { lock.current=false; setBusy(false); }
  }
  if (!allowed) return <Navigate to="/inicio" replace />;
  if(!loading && !ready) return <main className="rc-page"><h1>{t('rc_title')}</h1><p role="alert">{error}</p><BtnPrimary onClick={refresh}>{t('global_retry')}</BtnPrimary></main>;
  const options = (rows, label) => rows.map(row => ({ value: row.id, label: label(row) }));
  const ownLines = id => data.lines.filter(line => line.receipt_id === id);
  const canTask = task => supervisor || task.operator_id === access.userId || task.additional_operator_ids?.includes(access.userId);
  const receipts = data.receipts.filter(row => {
    const day = localDay(row.created_at);
    return row.status!=='cancelled' && (!from || day >= from) && (!to || day <= to) && (!filter || receiptState(row,data.lines,data.tasks) === filter)
      && (!search || `${row.code} ${row.manifest} ${row.trailer} ${data.suppliers.find(s=>s.id===row.supplier_id)?.name || ''} ${ownLines(row.id).map(l=>l.part_number).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  }).sort((a,b) => b.code-a.code);
  const receipt = data.receipts.find(row => row.id === selected);
  const selectedLines = receipt ? ownLines(receipt.id) : [];
  const tasks = data.tasks.filter(task => {
    const day=localDay(task.started_at);
    const row=data.receipts.find(r=>r.id===task.receipt_id);
    return task.status!=='cancelled' && row && row.status!=='cancelled' && (!from || day>=from) && (!to || day<=to)
      && (!filter || receiptState(row,data.lines,data.tasks)===filter)
      && (!search || `${row.code} ${row.manifest} ${row.trailer} ${ownLines(row.id).map(l=>l.part_number).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  });
  function openFinish(task) {
    setFinishTask(task); setActual(Object.fromEntries(ownLines(task.receipt_id).map(l=>[l.id,{received:String(l.expected),damaged:'0',note:''}])));
  }
  function openPut(line) { setPutAdditional([]);setPutLine(line); setPutLocation(''); setPutQuantity(String(line.available_to_store)); putId.current=newId(); }
  const currentTab=receiver?tab:'summary';
  const tabs = receiver ? ['pending','summary','productivity', ...(manage?['catalogs']:[])] : ['summary'];
  return <main className="rc-page">
    <div className="rc-heading"><div><span>DAEHAN APP</span><h1>{t('rc_title')}</h1></div></div>
    <DepartmentNav items={tabs.map(key=>({key,label:t(`rc_${key}`)}))} value={currentTab} onChange={key=>{setTab(key);}} label={t('rc_title')}/>
    {error && <div className="rc-alert rc-error" role="alert">{error}</div>}{message && <div className="rc-alert" role="status">{message}</div>}
    {loading ? <p>{t('loading')}</p> : <>
    {['pending','summary','productivity'].includes(currentTab) && <>
      <div className="rc-filters"><Field label={t('rc_from')} type="date" value={from} onChange={setFrom}/><Field label={t('rc_to')} type="date" value={to} onChange={setTo}/>
        <SelectField label={t('rc_type')} value={filter} onChange={setFilter} options={[{value:'',label:t('rc_all')},...['pending','process','paused','completed'].map(key=>({value:key,label:t(`rc_status_${key}`)}))]}/>
        <Field label={t('rc_search')} value={search} onChange={setSearch}/><BtnSecondary onClick={()=>{setFrom('');setTo('');setFilter('');setSearch('');}}>{t('rc_clear')}</BtnSecondary>
      </div>
      <div className="rc-metrics">{['pending','process','paused','completed'].map(key=><div key={key} style={{borderTopColor:statusColors[key]}}><strong>{receipts.filter(r=>receiptState(r,data.lines,data.tasks)===key).length}</strong><span>{t(`rc_status_${key}`)}</span></div>)}</div>
    </>}
    {currentTab==='pending' && <>
      <div className="rc-toolbar"><BtnPrimary disabled={busy || data.tasks.some(task=>task.status==='running' && (task.operator_id===access.userId || task.additional_operator_ids?.includes(access.userId)))} onClick={()=>{setAdditional([]);setNewReceipt(true);receiptId.current=newId();setReceiptDraft(blankReceipt());}}>{t('rc_new')}</BtnPrimary></div>
      <div className="rc-cards">{receipts.filter(row=>(!['completed','cancelled'].includes(receiptState(row,data.lines,data.tasks)) || ownLines(row.id).some(l=>l.quality_status==='held'))).map(row=>{
        const state=receiptState(row,data.lines,data.tasks);
        return <article className="rc-card" key={row.id} style={{borderLeftColor:statusColors[state]}}>
          <div className="rc-card-top"><strong>{t('rc_receipt')} #{row.code}</strong><span className="rc-badge" style={{background:statusColors[state]}}>{t(`rc_status_${state}`)}</span></div>
          <p>{data.suppliers.find(s=>s.id===row.supplier_id)?.name} · {row.manifest}</p><p>{t('rc_trailer')}: {row.trailer} · DOCK {row.dock}</p>
          {data.tasks.filter(task=>task.receipt_id===row.id&&activeTask(task)).map(task=><div key={task.id}><p>{t('rc_operator')}: {data.users.find(u=>u.uid===task.operator_id)?.nombre||task.operator_id}</p>{!!task.additional_operator_ids?.length&&<p>{t('rc_additional_operators')}: {task.additional_operator_ids.map(uid=>data.users.find(u=>u.uid===uid)?.nombre||uid).join(', ')}</p>}</div>)}
          {ownLines(row.id).map(line=><p key={line.id}><strong>{line.part_number}</strong> · {fmt(line.received)} / {fmt(line.expected)} {line.uom}{line.quality_status==='held' && <span className="rc-held">{t('rc_held')}</span>}</p>)}
          <BtnPrimary onClick={()=>setSelected(row.id)}>{t('rc_details')}</BtnPrimary>
        </article>;
      })}</div>{!receipts.some(r=>(!['completed','cancelled'].includes(receiptState(r,data.lines,data.tasks)) || ownLines(r.id).some(l=>l.quality_status==='held'))) && <p>{t('rc_no_data')}</p>}
    </>}
    {currentTab==='summary' && <div className="rc-table-wrap"><table><thead><tr>{['receipt','supplier','manifest','trailer','staging','type','received','stored','actions'].map(key=><th key={key}>{t(`rc_${key}`)}</th>)}</tr></thead>
      <tbody>{receipts.map(row=><tr key={row.id} style={{background:statusColors[receiptState(row,data.lines,data.tasks)]+'66'}}><td>#{row.code}</td><td>{data.suppliers.find(s=>s.id===row.supplier_id)?.name}</td><td>{row.manifest}</td><td>{row.trailer}<small>DOCK {row.dock}</small></td><td>{data.locations.find(l=>l.id===row.staging_id)?.code}</td><td>{t(`rc_status_${receiptState(row,data.lines,data.tasks)}`)}</td><td>{ownLines(row.id).map(l=><div key={l.id}>{l.part_number}: {fmt(l.received)} {l.uom}<small>{t('rc_shortage')}: {fmt(Math.max(0,l.expected-l.received))} · {t('rc_surplus')}: {fmt(Math.max(0,l.received-l.expected))} · {t('rc_damaged')}: {fmt(l.damaged)}</small></div>)}</td><td>{ownLines(row.id).map(l=><div key={l.id}>{l.part_number}: {fmt(l.stored)} {l.uom}</div>)}</td><td><BtnSecondary onClick={()=>setSelected(row.id)}>{t('rc_details')}</BtnSecondary></td></tr>)}</tbody></table></div>}
    {tab==='productivity' && <>
      <div className="rc-table-wrap"><table><thead><tr>{['operator','activity','uom','activities','total','minutes','uph'].map(key=><th key={key}>{t(`rc_${key}`)}</th>)}</tr></thead><tbody>
      {productivity(tasks,data.lines).map(row=><tr key={`${row.operator_id}:${row.kind}:${row.uom}`}><td>{data.users.find(u=>u.uid===row.operator_id)?.nombre || row.operator_id}</td><td>{t(`rc_${row.kind}`)}</td><td>{row.uom==='mixed'?t('rc_mixed'):row.uom}</td><td>{row.activities}</td><td>{row.uom==='mixed'?'—':fmt(row.quantity)}</td><td>{fmt(row.seconds/60)}</td><td>{row.uph===null?'—':fmt(row.uph)}</td></tr>)}</tbody></table></div>
      <div className="rc-table-wrap"><table><thead><tr>{['receipt','operator','activity','started','ended','pauses','minutes'].map(key=><th key={key}>{t(`rc_${key}`)}</th>)}</tr></thead><tbody>{tasks.map(task=><tr key={task.id}><td>#{data.receipts.find(r=>r.id===task.receipt_id)?.code}</td><td>{data.users.find(u=>u.uid===task.operator_id)?.nombre || task.operator_id}</td><td>{t(`rc_${task.kind}`)}<small>{t(`rc_${task.status}`)}</small></td><td>{date(task.started_at)}</td><td>{date(task.finished_at)}</td><td>{fmt(task.pause_seconds/60)}</td><td>{task.status==='finished'?fmt(effectiveSeconds(task)/60):'—'}</td></tr>)}</tbody></table></div>
    </>}
    {tab==='catalogs' && manage && <Catalogos access={access}/>}
    </>}
    {newReceipt && <div className="rc-modal" role="dialog" aria-modal="true" aria-label={t('rc_new')}><section className="rc-dialog"><h2>{t('rc_new')}</h2><p>{t('rc_start_before')}</p><form onSubmit={e=>{e.preventDefault();run(async()=>{
      if(!receiptDraft.supplier_id)throw Error('receiving_invalid');
      await service.start(receiptId.current,{...receiptDraft,additional_operator_ids:additional,lines:receiptDraft.lines.map(l=>({...l,expected:quantity(l.expected)}))});setNewReceipt(false);
    });}}><p>{t('rc_operator')}: {data.users.find(u=>u.uid===access.userId)?.nombre || access.name}</p><SelectField multi label={t('rc_additional_operators')} value={additional} onChange={setAdditional} options={data.users.filter(u=>u.activo&&u.assigned&&u.uid!==access.userId).map(u=>({value:u.uid,label:u.nombre}))}/><div className="rc-grid">
      <SelectField label={t('rc_supplier')} value={receiptDraft.supplier_id} options={options(data.suppliers.filter(s=>s.active),s=>`${s.code} · ${s.name}`)} onChange={supplier_id=>setReceiptDraft({...receiptDraft,supplier_id})}/>
      <Field required label={t('rc_manifest')} value={receiptDraft.manifest} onChange={manifest=>setReceiptDraft({...receiptDraft,manifest})}/><Field label={t('rc_po_number')} value={receiptDraft.po_number} onChange={po_number=>setReceiptDraft({...receiptDraft,po_number})}/><Field required label={t('rc_dock')} inputMode="numeric" value={receiptDraft.dock} onChange={dock=>setReceiptDraft({...receiptDraft,dock:dock.replace(/\D/g,'')})}/>
      <Field required label={t('rc_trailer')} value={receiptDraft.trailer} onChange={trailer=>setReceiptDraft({...receiptDraft,trailer:trailer.toUpperCase()})}/>
    </div>{receiptDraft.lines.map((line,index)=><div className="rc-product-row" key={index}>
      <SelectField label={t('rc_type')} value={line.category} options={['RAW','PACKAGING'].map(value=>({value,label:t('rc_'+value)}))} onChange={category=>setReceiptDraft({...receiptDraft,lines:receiptDraft.lines.map((l,i)=>i===index?{...l,category,item_id:''}:l)})}/>
      <SelectField label={t('rc_item')} value={line.item_id} options={options(data.items.filter(i=>i.active && i.category===line.category && ['RAW','PACKAGING'].includes(i.category)),itemLabel)} onChange={item_id=>setReceiptDraft({...receiptDraft,lines:receiptDraft.lines.map((l,i)=>i===index?{...l,item_id}:l)})}/>
      {['expected'].map(key=><Field key={key} required={key==='expected'} label={t(`rc_${key}`)} type={key==='expected'?'number':'text'} min={key==='expected'?0:undefined} step="any" value={line[key]} onChange={value=>setReceiptDraft({...receiptDraft,lines:receiptDraft.lines.map((l,i)=>i===index?{...l,[key]:value}:l)})}/>)}
      <BtnDanger type="button" disabled={receiptDraft.lines.length===1} onClick={()=>setReceiptDraft({...receiptDraft,lines:receiptDraft.lines.filter((_,i)=>i!==index)})}>{t('rc_remove')}</BtnDanger>
    </div>)}<div className="rc-toolbar"><BtnSecondary type="button" onClick={()=>setReceiptDraft({...receiptDraft,lines:[...receiptDraft.lines,blankLine()]})}>{t('rc_add')}</BtnSecondary><BtnPrimary disabled={busy}>{t('rc_start')}</BtnPrimary><BtnSecondary type="button" disabled={busy} onClick={()=>setNewReceipt(false)}>{t('rc_close')}</BtnSecondary></div></form></section></div>}
    {receipt && <div className="rc-modal" role="dialog" aria-modal="true" aria-label={t('rc_details')}><section className="rc-dialog"><div className="rc-heading"><h2>{t('rc_receipt')} #{receipt.code}</h2><BtnSecondary onClick={()=>setSelected('')}>{t('rc_close')}</BtnSecondary></div>
      {receipt.po_number && <p>{t('rc_po_number')}: {receipt.po_number}</p>}<p>{receipt.manifest} · {receipt.trailer} · DOCK {receipt.dock}</p><p>{t('rc_quarantine_help')}</p>
      {selectedLines.map(line=><article className="rc-card" key={line.id}><strong>{itemLabel(line)}</strong><p>{t('rc_received')}: {fmt(line.received)} · {t('rc_stored')}: {fmt(line.stored)} · {t('rc_remaining')}: {fmt(line.received-line.stored)} {line.uom}</p>
        <p>{t('rc_shortage')}: {fmt(Math.max(0,line.expected-line.received))} · {t('rc_surplus')}: {fmt(Math.max(0,line.received-line.expected))} · {t('rc_damaged')}: {fmt(line.damaged)}</p><p>{t(`rc_${line.quality_status}`)} {line.hold_reason || ''}</p>{line.note && <p>{line.note}</p>}
        <div className="rc-toolbar">{receiver && receipt.status==='received' && number(line.available_to_store)>0 && <BtnPrimary disabled={busy} onClick={()=>openPut(line)}>{t('rc_start')}</BtnPrimary>}
        {(supervisor || qualityAccess) && line.received>0 && !['held','rejected'].includes(line.quality_status) && <BtnDanger disabled={busy} onClick={()=>{setHoldLine(line);setReason('');}}>{t('rc_quarantine')}</BtnDanger>}</div>
        {line.quality_status==='held' && <p>{t('rc_release_quality')}</p>}
      </article>)}
      {data.tasks.filter(task=>task.receipt_id===receipt.id && task.status!=='cancelled').map(task=><article className="rc-card" key={task.id}><strong>{t(`rc_${task.kind}`)} · {t(`rc_${task.status}`)}</strong><p>{t('rc_operator')}: {data.users.find(u=>u.uid===task.operator_id)?.nombre || task.operator_id}</p>{!!task.additional_operator_ids?.length && <p>{t('rc_additional_operators')}: {task.additional_operator_ids.map(uid=>data.users.find(u=>u.uid===uid)?.nombre||uid).join(', ')}</p>}
        {task.kind==='putaway' && <p>{fmt(task.quantity)} {data.lines.find(l=>l.id===task.line_id)?.uom} · {data.locations.find(l=>l.id===task.location_id)?.code}</p>}
        {canTask(task) && activeTask(task) && <div className="rc-toolbar"><BtnSecondary disabled={busy} onClick={()=>run(()=>service.task(task.id,task.status==='paused'?'resume':'pause'))}>{t(task.status==='paused'?'rc_resume':'rc_pause')}</BtnSecondary>
          <BtnPrimary disabled={busy} onClick={()=>task.kind==='unload'?openFinish(task):run(()=>service.task(task.id,'finish'))}>{t('rc_finish')}</BtnPrimary></div>}
      </article>)}
    </section></div>}
    {finishTask && <div className="rc-modal" role="dialog" aria-modal="true" aria-label={t('rc_review')}><section className="rc-dialog"><h2>{t('rc_review')}</h2><p>{t('rc_stock_help')}</p>{ownLines(finishTask.receipt_id).map(line=><article className="rc-card" key={line.id}><strong>{itemLabel(line)}</strong><p>{t('rc_expected')}: {fmt(line.expected)} {line.uom}</p><div className="rc-grid">{['received','damaged','note'].map(key=><Field key={key} label={t(`rc_${key}`)} value={actual[line.id]?.[key] || ''} type={key==='note'?'text':'number'} min="0" step="any" onChange={value=>setActual({...actual,[line.id]:{...actual[line.id],[key]:value}})}/>)}</div><p>{t('rc_shortage')}: {fmt(Math.max(0,line.expected-number(actual[line.id]?.received)))} · {t('rc_surplus')}: {fmt(Math.max(0,number(actual[line.id]?.received)-line.expected))}</p></article>)}<div className="rc-toolbar"><BtnPrimary disabled={busy} onClick={()=>run(async()=>{await service.task(finishTask.id,'finish',finishLines(ownLines(finishTask.receipt_id),actual));setFinishTask(null);})}>{t('rc_finish')}</BtnPrimary><BtnSecondary disabled={busy} onClick={()=>setFinishTask(null)}>{t('rc_close')}</BtnSecondary></div></section></div>}
    {putLine && <div className="rc-modal" role="dialog" aria-modal="true" aria-label={t('rc_putaway')}><section className="rc-dialog"><h2>{t('rc_putaway')}</h2><p>{itemLabel(putLine)}</p><p>{t(`rc_${putLine.quality_status}`)}</p>
      <p>{t('rc_operator')}: {data.users.find(u=>u.uid===access.userId)?.nombre || access.name}</p><SelectField multi label={t('rc_additional_operators')} value={putAdditional} onChange={setPutAdditional} options={data.users.filter(u=>u.activo&&u.assigned&&u.uid!==access.userId).map(u=>({value:u.uid,label:u.nombre}))}/><SelectField label={t('rc_location')} value={putLocation} onChange={setPutLocation} options={options(allowedLocations(putLine.item_id,data.locations,data.assignments),locationLabel)}/>
      {!allowedLocations(putLine.item_id,data.locations,data.assignments).length && <p role="alert">{t('rc_no_locations')}</p>}
      <Field label={t('rc_quantity')} type="number" min="0" step="any" value={putQuantity} onChange={setPutQuantity}/><div className="rc-toolbar"><BtnPrimary disabled={busy || !putLocation} onClick={()=>run(async()=>{await service.putaway(putId.current,putLine.id,putLocation,putQuantity,putAdditional);setPutLine(null);})}>{t('rc_start')}</BtnPrimary><BtnSecondary disabled={busy} onClick={()=>setPutLine(null)}>{t('rc_close')}</BtnSecondary></div>
    </section></div>}
    {holdLine && <div className="rc-modal" role="dialog" aria-modal="true" aria-label={t('rc_quarantine')}><section className="rc-dialog"><h2>{t('rc_quarantine')}</h2><p>{itemLabel(holdLine)} · {fmt(holdLine.received)} {holdLine.uom}</p><Field label={t('rc_reason')} value={reason} onChange={setReason}/><div className="rc-toolbar"><BtnDanger disabled={busy || !reason.trim()} onClick={()=>run(async()=>{await service.hold(holdLine.id,reason.trim());setHoldLine(null);})}>{t('rc_quarantine')}</BtnDanger><BtnSecondary disabled={busy} onClick={()=>setHoldLine(null)}>{t('rc_close')}</BtnSecondary></div></section></div>}

  </main>;
}
