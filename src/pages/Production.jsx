
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import { Navigate,useNavigate } from 'react-router-dom';
import Modal from 'react-modal';
import Papa from 'papaparse';
import {useTranslation} from 'react-i18next';
import ModuleHeading from '../components/ModuleHeading';
import DepartmentNav from '../components/DepartmentNav';
import {CatalogInput,CatalogSelect} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary,BtnEditDark,BtnDanger,TablePagination} from '../components/controls';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
import {usePageSection} from '../usePageSection';
import {registerProduction} from '../production/translations';
import {recipeSelect,normalizeRecipes} from '../production/queries.mjs';
import {reportMetrics,consumptionPreview,isRepack,isTurntable,validateReport} from '../production/model.mjs';
import i18n from '../i18n/i18n';
import './Production.css';
import './Catalogos.css';
registerProduction(i18n);
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data;};
const day=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const blank=()=>({id:crypto.randomUUID(),production_date:day(),station_code:'',item_id:'',start_time:'',end_time:'',ends_next_day:false,machine_minutes:'',downtime_minutes:'0',downtime_reason:'',break_count:'0',break_minutes:'0',people:'',machine_quantity:'0',scrap_quantity:'0',rework_quantity:'0',packaging_type:'',full_boxes:'0',pallets:'0',pieces_per_box:0,turns:'',report_mode:'production',note:'',status:'draft'});
const tables=['production_station_reports','production_station_consumptions','inventory_production_reports','inventory_workstations','inventory_items','inventory_boms','inventory_bom_lines','inventory_bom_packaging','inventory_bom_packaging_lines','inventory_movements','catalog_updates','productos'];
export default function Production({access}) {
 const {t,i18n:lang}=useTranslation(),navigate=useNavigate();
 const allowed=access.admin||access.memberships.some(m=>m.department==='production');
 const supervisor=access.admin||access.memberships.some(m=>m.department==='production'&&m.role==='supervisor');
 const manage=supervisor||access.memberships.some(m=>m.department==='production'&&m.role==='lider');
 const [tab,setTab]=usePageSection('production','records',['records','summary']);
 const [data,setData]=useState({reports:[],items:[],stations:[],boms:[],balances:[],consumptions:[]});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [filter,setFilter]=useState(''),[stationFilter,setStationFilter]=useState(''),[statusFilter,setStatusFilter]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[edit,setEdit]=useState(null),[review,setReview]=useState(null);
 const [confirming,setConfirming]=useState(false);
 const lock=useRef(false),live=useRef(true),request=useRef(0),form=useRef(null);
 const fmt=value=>Number(value||0).toLocaleString(lang.language,{maximumFractionDigits:3});
 const refresh=useCallback(async()=>{
  if(!allowed)return;
  const version=++request.current;
  const [reports,items,stations,boms,balances,consumptions]=await Promise.all([
   unwrap(supabase.from('production_station_reports').select('*').order('production_date',{ascending:false}).order('created_at',{ascending:false})),
   unwrap(supabase.from('inventory_items').select('id,producto_id,part_number,part_name,description,category,uom,active,productos(nombre,descripcion)').order('part_number')),
   unwrap(supabase.from('inventory_workstations').select('*').order('code')),
   unwrap(supabase.from('inventory_boms').select(recipeSelect).eq('archived',false)),
   unwrap(supabase.from('inventory_balances').select('item_id,area,quantity')),
   unwrap(supabase.from('production_station_consumptions').select('*'))
  ]);
  if(live.current&&version===request.current){setData({reports,items:items.map(i=>({...i,part_name:i.productos?.nombre||i.part_name,description:i.productos?.descripcion??i.description})),stations,boms:normalizeRecipes(boms),balances,consumptions});setError('');setLoading(false);}
 },[allowed]);
 useEffect(()=>{live.current=true;refresh().catch(e=>{if(live.current){setError(e.message);setLoading(false);}});const off=subscribeUpdates(supabase,'production-web',tables,()=>refresh().catch(e=>live.current&&setError(e.message)));return()=>{live.current=false;++request.current;off();};},[refresh]);
 const itemFor=r=>data.items.find(i=>i.id===r.item_id),stationFor=r=>data.stations.find(s=>s.code===r.station_code);
 const bomFor=r=>data.boms.find(b=>b.id===r.bom_id)||data.boms.find(b=>b.finished_item_id===r.item_id&&b.active);
 const profileFor=(r,bom=bomFor(r))=>bom?.inventory_bom_packaging?.find(p=>p.packaging_type===r.packaging_type);
 const editable=r=>r.status==='draft'&&(manage||r.created_by===access.userId);
 const filtered=useMemo(()=>data.reports.filter(r=>{
  const i=data.items.find(i=>i.id===r.item_id),s=data.stations.find(s=>s.code===r.station_code);
  return (!stationFilter||r.station_code===stationFilter)&&(!statusFilter||r.status===statusFilter)&&(!from||r.production_date>=from)&&(!to||r.production_date<=to)&&(!filter.trim()||[i?.part_number,i?.part_name,s?.name,r.station_code,r.note].join(' ').toLowerCase().includes(filter.trim().toLowerCase()));
 }),[data,stationFilter,statusFilter,from,to,filter]);
 useEffect(()=>setPage(1),[filter,stationFilter,statusFilter,from,to]);
 async function action(type,r) {
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try {
   const payload=type==='save'||type==='submit'?Object.fromEntries(Object.entries(r).filter(([k])=>!['created_by','created_at','updated_at','reviewed_by','reviewed_at','inventory_report_id','good_quantity','packed_quantity','elapsed_minutes','bom_id','status'].includes(k))):{id:r.id};
   if(type==='save'||type==='submit'){
    const selectedBom=data.boms.find(b=>b.finished_item_id===r.item_id&&b.active);
    const validation=validateReport(r,{station:stationFor(r),bom:selectedBom,profile:profileFor(r,selectedBom),forSubmit:type==='submit'});
    if(validation)throw Error(validation);
    for(const k of ['machine_minutes','downtime_minutes','break_count','break_minutes','people','machine_quantity','scrap_quantity','rework_quantity','full_boxes','pallets'])payload[k]=Number(payload[k]);
    payload.turns=payload.turns===''||payload.turns==null?null:Number(payload.turns);
    payload.packaging_type=payload.packaging_type||null;
   }
   await unwrap(supabase.rpc('production_station_action',{p_action:type,p_data:payload}));
   await refresh();setEdit(null);setReview(null);setConfirming(false);setMessage(t(type==='post'?'pr_posted_help':type==='submit'?'pr_submitted_help':'global_saved'));
  } catch(e){const translated=t(e.message,{defaultValue:''});setError(translated&&translated!==e.message?translated:t('pr_save_error'));}finally{lock.current=false;setBusy(false);}
 }
 const totals=filtered.reduce((a,r)=>{
  const m=reportMetrics(r);
  for(const key of ['machine_quantity','scrap_quantity','rework_quantity','good_quantity','full_boxes','packed_quantity'])a[key]+=Number(r[key]||0);
  a.elapsed+=Number(r.elapsed_minutes||0);a.machine+=Number(r.machine_minutes||0);a.downtime+=Number(r.downtime_minutes||0);a.breaks+=Number(r.break_minutes||0);a.labor+=m.laborHours;
  return a;
 },{machine_quantity:0,scrap_quantity:0,rework_quantity:0,good_quantity:0,full_boxes:0,packed_quantity:0,elapsed:0,machine:0,downtime:0,breaks:0,labor:0});
 const byStation=Object.values(filtered.reduce((a,r)=>{
  const s=a[r.station_code]||(a[r.station_code]={code:r.station_code,pieces:0,scrap:0,rework:0,boxes:0,machine:0,downtime:0,labor:0});
  s.pieces+=Number(r.machine_quantity);s.scrap+=Number(r.scrap_quantity);s.rework+=Number(r.rework_quantity);s.boxes+=Number(r.full_boxes);s.machine+=Number(r.machine_minutes);s.downtime+=Number(r.downtime_minutes);s.labor+=reportMetrics(r).laborHours;return a;
 },{}));
 function exportCsv() {
  const csv=Papa.unparse(filtered.map(r=>({
   [t('pr_date')]:r.production_date,[t('inv_station_code')]:r.station_code,[t('name')]:stationFor(r)?.name,
   [t('inv_part')]:itemFor(r)?.part_number,[t('description')]:itemFor(r)?.description,
   [t('pr_start')]:r.start_time,[t('pr_end')]:r.end_time,[t('pr_next_day')]:t(r.ends_next_day?'yes':'no'),
   [t('pr_total_hours')]:r.elapsed_minutes/60,[t('pr_worked_hours')]:reportMetrics(r).worked/60,[t('pr_labor_hours')]:reportMetrics(r).laborHours,
   [t('pr_machine_minutes')]:r.machine_minutes,[t('pr_downtime')]:r.downtime_minutes,[t('pr_downtime_reason')]:r.downtime_reason,
   [t('pr_break_count')]:r.break_count,[t('pr_break_minutes')]:r.break_minutes,[t('pr_people')]:r.people,
   [t('pr_machine_quantity')]:r.machine_quantity,[t('pr_good')]:r.good_quantity,[t('pr_scrap')]:r.scrap_quantity,[t('pr_rework')]:r.rework_quantity,
   [t('pr_packing_type')]:r.packaging_type?t('pr_'+r.packaging_type):'',[t('pr_boxes')]:r.full_boxes,[t('pr_pallets')]:r.pallets,[t('pr_packed')]:r.packed_quantity,
   [t('pr_turns')]:r.turns??'',[t('status')]:t('pr_'+r.status),[t('inv_notes')]:r.note
  })),{escapeFormulae:true});
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='production.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const eBom=edit?data.boms.find(b=>b.finished_item_id===edit.item_id&&b.active):null;
 const eProfile=edit?profileFor(edit,eBom):null;
 const metrics=edit?reportMetrics(edit,eProfile):null;
 const repack=edit&&isRepack(eBom,edit.item_id);
 const preview=r=>r.status==='posted'?data.consumptions.filter(c=>c.report_id===r.id):consumptionPreview(r,bomFor(r),data.items,profileFor(r));
 const stock=(id,area)=>Number(data.balances.find(b=>b.item_id===id&&b.area===area)?.quantity||0);
 const numeric=(key,label,{min=0,step='1',required=true}={})=><CatalogInput key={key} label={t(label)} required={required} type="number" min={min} step={step} value={edit[key]??''} onChange={ev=>setEdit({...edit,[key]:ev.target.value})}/>;
 const consumptionTable=r=><div className="table-wrap"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('name')}</th><th>{t('inv_area')}</th><th>{t('pr_consume')}</th><th>{t('inv_unit')}</th>{r.status!=='posted'&&<th>{t('inv_balance')}</th>}</tr></thead><tbody>
  {preview(r).map(c=>{const i=data.items.find(i=>i.id===c.ingredient_id);return <tr key={c.ingredient_id+c.area+c.source}><td>{i?.part_number}</td><td>{i?.part_name}</td><td>{t('inv_area_'+c.area)}</td><td>{fmt(c.quantity)}</td><td>{i?.uom}</td>{r.status!=='posted'&&<td className={stock(c.ingredient_id,c.area)<c.quantity?'production-short':''}>{fmt(stock(c.ingredient_id,c.area))}</td>}</tr>;})}
 </tbody></table></div>;
 if(!allowed)return <Navigate to="/inicio" replace/>;
 return <><div className="module-department-nav"><ModuleHeading title={t('global_production')}/><DepartmentNav value={tab} onChange={key=>key==='catalog'?navigate('/catalogos'):key==='inventory'?navigate('/inventarios'):setTab(key)} label={t('global_production')} items={[{key:'records',label:t('records')},{key:'summary',label:t('summary')},{key:'catalog',label:t('catalogs')},{key:'inventory',label:t('inv_title')}].map(x=>({...x}))} /></div>
 <main className="page-container page-container--fluid production-page">
  <section className="card">
   <div className="catalog-toolbar"><h2 className="module-title">{t(tab==='summary'?'pr_summary':'pr_records')}</h2>
   <div className="catalog-filters production-filters">
    <CatalogInput label={t('pr_from')} type="date" value={from} onChange={ev=>setFrom(ev.target.value)}/>
    <CatalogInput label={t('pr_to')} type="date" value={to} onChange={ev=>setTo(ev.target.value)}/>
    <CatalogSelect label={t('inv_station_code')} value={stationFilter} onChange={setStationFilter} options={[{value:'',label:t('rc_all')},...data.stations.map(s=>({value:s.code,label:s.code+' · '+s.name}))]}/>
    <CatalogSelect label={t('status')} value={statusFilter} onChange={setStatusFilter} options={[{value:'',label:t('rc_all')},...['draft','submitted','posted'].map(value=>({value,label:t('pr_'+value)}))]}/>
    <CatalogInput label={t('search')} value={filter} onChange={ev=>setFilter(ev.target.value)}/>
   </div><div className="catalog-actions production-actions">
    <BtnSecondary onClick={()=>{setFilter('');setStationFilter('');setStatusFilter('');setFrom('');setTo('');}}>{t('clear_filters')}</BtnSecondary>
    <BtnSecondary onClick={exportCsv}>{t('export_csv')}</BtnSecondary>
    <BtnPrimary disabled={busy||loading} onClick={()=>{setError('');setEdit(blank());}}>➕ {t('pr_new_report')}</BtnPrimary>
   </div></div>
   {error&&<p role="alert" className="inv-message">{error}</p>}{message&&<p role="status" className="inv-message">{message}</p>}
   <p className="inv-muted">{t('pr_workflow_hint')}</p>
   {loading?<p>{t('loading')}</p>:tab==='summary'?<>
    <p className="inv-muted">{t('pr_summary_hint')}</p><div className="production-metrics">{[['pr_machine_quantity',totals.machine_quantity],['pr_good',totals.good_quantity],['pr_scrap',totals.scrap_quantity],['pr_rework',totals.rework_quantity],['pr_boxes',totals.full_boxes],['pr_labor_hours',totals.labor]].map(([label,value])=><div key={label}><span>{t(label)}</span><strong>{fmt(value)}</strong></div>)}</div>
    <div className="table-wrap"><table className="table"><thead><tr>{['inv_station_code','name','pr_machine_quantity','pr_scrap','pr_rework','pr_boxes','pr_machine_minutes','pr_downtime','pr_labor_hours'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{byStation.map(s=><tr key={s.code}><td>{s.code}</td><td>{data.stations.find(x=>x.code===s.code)?.name}</td>{['pieces','scrap','rework','boxes','machine','downtime','labor'].map(k=><td key={k}>{fmt(s[k])}</td>)}</tr>)}</tbody></table></div>
   </>:<div className="table-wrap catalog-table-scroll"><table className="table"><thead><tr>{['pr_date','inv_station_code','inv_part','name','pr_machine_quantity','pr_good','pr_scrap','pr_rework','pr_boxes','pr_packing_type','pr_machine_minutes','pr_downtime','pr_people','pr_total_hours','pr_labor_hours','pr_turns','status','actions'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>
    {filtered.slice((Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))-1)*pageSize,Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))*pageSize).map(r=><tr key={r.id}><td>{r.production_date}</td><td title={stationFor(r)?.name}>{r.station_code}</td><td>{itemFor(r)?.part_number}</td><td>{itemFor(r)?.part_name}</td>{['machine_quantity','good_quantity','scrap_quantity','rework_quantity','full_boxes'].map(k=><td key={k}>{fmt(r[k])}</td>)}<td>{r.packaging_type?t('pr_'+r.packaging_type):'—'}</td><td>{fmt(r.machine_minutes)}</td><td>{fmt(r.downtime_minutes)}</td><td>{r.people}</td><td>{fmt(r.elapsed_minutes/60)}</td><td>{fmt(reportMetrics(r).laborHours)}</td><td>{r.turns??'—'}</td><td><span className={'production-status production-status-'+r.status}>{t('pr_'+r.status)}</span></td><td><div className="production-row-actions">
     <BtnSecondary disabled={busy} onClick={()=>{setError('');setConfirming(false);setReview(r);}}>{t('pr_details')}</BtnSecondary>
     {editable(r)&&<><BtnEditDark disabled={busy} onClick={()=>{setError('');setEdit({...r,turns:r.turns??'',packaging_type:r.packaging_type||''});}}>{t('edit')}</BtnEditDark><BtnDanger disabled={busy} onClick={()=>window.confirm(t('pr_delete_confirm'))&&action('delete',r)}>{t('delete')}</BtnDanger></>}
    </div></td></tr>)}
    {!filtered.length&&<tr><td colSpan="18">{t('no_results_found')}</td></tr>}
   </tbody></table><TablePagination totalRows={filtered.length} page={Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}}/></div>}
  </section>
 </main>
 <Modal isOpen={!!edit} onRequestClose={()=>!busy&&setEdit(null)} style={{overlay:{zIndex:10000,backgroundColor:'#0008'},content:{width:'min(1120px, calc(100vw - 32px))',maxHeight:'88vh',inset:'50% auto auto 50%',transform:'translate(-50%,-50%)'}}}>
 {edit&&<form ref={form} className="production-form catalog-dialog" onSubmit={ev=>{ev.preventDefault();action('save',edit);}}>
  <h2>{t('pr_new_report')}</h2><fieldset disabled={busy}><div className="catalog-fields">
   <CatalogInput label={t('pr_date')} required type="date" value={edit.production_date} onChange={ev=>setEdit({...edit,production_date:ev.target.value})}/>
   <CatalogSelect label={t('inv_station_code')} value={edit.station_code} onChange={station_code=>setEdit({...edit,station_code,turns:''})} options={data.stations.filter(s=>s.active||s.code===edit.station_code).map(s=>({value:s.code,label:s.code+' · '+s.name}))}/>
   <CatalogSelect label={t('inv_part')} value={edit.item_id} onChange={item_id=>setEdit({...edit,item_id,packaging_type:'',full_boxes:'0',pallets:'0'})} options={data.items.filter(i=>i.active&&i.category!=='PACKAGING').map(i=>({value:i.id,label:i.part_number+' · '+i.part_name+' ('+i.category+')'}))}/>
   <CatalogSelect label={t('pr_report_mode')} value={edit.report_mode} onChange={report_mode=>setEdit({...edit,report_mode})} options={['production','packing'].map(value=>({value,label:t('pr_mode_'+value)}))}/>
   <CatalogInput label={t('pr_start')} required type="time" value={edit.start_time} onChange={ev=>setEdit({...edit,start_time:ev.target.value})}/>
   <CatalogInput label={t('pr_end')} required type="time" value={edit.end_time} onChange={ev=>setEdit({...edit,end_time:ev.target.value})}/>
   <label className="catalog-checkbox"><input type="checkbox" checked={edit.ends_next_day} onChange={ev=>setEdit({...edit,ends_next_day:ev.target.checked})}/>{t('pr_next_day')}</label>
  </div><h3>{t('pr_machine_section')}</h3><div className="catalog-fields">
   {numeric('machine_minutes','pr_machine_minutes',{step:'any'})}{numeric('downtime_minutes','pr_downtime',{step:'any'})}
   <CatalogInput label={t('pr_downtime_reason')} required={Number(edit.downtime_minutes)>0} value={edit.downtime_reason} onChange={ev=>setEdit({...edit,downtime_reason:ev.target.value})}/>
   {numeric('break_count','pr_break_count')}{numeric('break_minutes','pr_break_minutes',{step:'any'})}{numeric('people','pr_people',{min:1})}
   {isTurntable(stationFor(edit))&&numeric('turns','pr_turns')}
  </div><h3>{t('pr_quantities')}</h3><p className="inv-muted">{t('pr_quantity_hint')}</p><div className="catalog-fields">
   {numeric('machine_quantity','pr_machine_quantity')}{numeric('scrap_quantity','pr_scrap')}{numeric('rework_quantity','pr_rework')}
   <CatalogInput label={t('pr_good')} readOnly value={fmt(metrics.good)}/>
  </div>
  <h3>{t('pr_packing')}</h3><p className="inv-muted">{t('pr_packing_capture_hint')}</p>{repack&&<p className="inv-message">{t('pr_repack_boxes')}</p>}
  <div className="catalog-fields">
   <CatalogSelect label={t('pr_packing_type')} value={edit.packaging_type} onChange={packaging_type=>setEdit({...edit,packaging_type})} options={(eBom?.inventory_bom_packaging||[]).map(p=>({value:p.packaging_type,label:t('pr_'+p.packaging_type)+' · '+p.box_name}))}/>
   {numeric('full_boxes','pr_boxes')}{numeric('pallets','pr_pallets')}
   <CatalogInput label={t('pr_pieces_per_box')} readOnly value={eProfile?.pieces_per_box||'—'}/>
   <CatalogInput label={t('pr_packed')} readOnly value={fmt(metrics.packed)}/>
  </div>
  {!eBom&&<p className="inv-message">{t('pr_recipe_missing')}</p>}
  {eBom&&!eBom.inventory_bom_packaging?.length&&<p className="inv-message">{t('pr_pack_missing')}</p>}
  {edit.report_mode==='packing'&&<p className="inv-message">{t('pr_packing_only_hint')}</p>}
  <h3>{t('pr_hours')}</h3><div className="production-metrics">{[['pr_total_hours',metrics.elapsed/60],['pr_worked_hours',metrics.worked/60],['pr_labor_hours',metrics.laborHours],['pr_idle_minutes',metrics.idle],['pr_pending_packing',repack?0:metrics.wip]].map(([label,value])=><div key={label}><span>{t(label)}</span><strong>{Number.isFinite(value)?fmt(value):'—'}</strong></div>)}</div>
  <p className="inv-muted">{t('pr_hours_hint')}</p>
  <h3>{t('pr_consumption_preview')}</h3>{consumptionTable({...edit,bom_id:eBom?.id,pieces_per_box:eProfile?.pieces_per_box||0})}
  <CatalogInput label={t('inv_notes')} value={edit.note} onChange={ev=>setEdit({...edit,note:ev.target.value})}/>
  </fieldset>{error&&<p role="alert" className="inv-message">{error}</p>}<div className="catalog-actions">
   <BtnSecondary disabled={busy} type="submit">{t('pr_save_draft')}</BtnSecondary>
   <BtnPrimary disabled={busy||!eBom} type="button" onClick={()=>{if(form.current.reportValidity())action('submit',edit);}}>{t('pr_submit')}</BtnPrimary>
   <BtnSecondary disabled={busy} type="button" onClick={()=>setEdit(null)}>{t('cancel')}</BtnSecondary>
  </div>
 </form>}
 </Modal>
 <Modal isOpen={!!review} onRequestClose={()=>!busy&&setReview(null)} style={{overlay:{zIndex:10000,backgroundColor:'#0008'},content:{width:'min(1000px, calc(100vw - 32px))',maxHeight:'88vh',inset:'50% auto auto 50%',transform:'translate(-50%,-50%)'}}}>
 {review&&<div className="production-form"><h2>{t('pr_details')} · {review.production_date}</h2>
  <p><strong>{review.station_code} · {stationFor(review)?.name}</strong></p><p>{itemFor(review)?.part_number} · {itemFor(review)?.part_name}</p>
  <div className="production-metrics">{[['pr_machine_quantity',review.machine_quantity],['pr_good',review.good_quantity],['pr_scrap',review.scrap_quantity],['pr_rework',review.rework_quantity],['pr_boxes',review.full_boxes],['pr_packed',review.packed_quantity],['pr_total_hours',review.elapsed_minutes/60],['pr_machine_minutes',review.machine_minutes],['pr_downtime',review.downtime_minutes],['pr_break_count',review.break_count],['pr_break_minutes',review.break_minutes],['pr_people',review.people],['pr_labor_hours',reportMetrics(review).laborHours]].map(([label,value])=><div key={label}><span>{t(label)}</span><strong>{fmt(value)}</strong></div>)}</div>
  <p>{t('pr_start')}: {review.start_time} · {t('pr_end')}: {review.end_time}{review.ends_next_day?' (+1)':''}</p>
  <p>{t('pr_packing_type')}: {review.packaging_type?t('pr_'+review.packaging_type):'—'} · {t('pr_pallets')}: {review.pallets} · {t('pr_turns')}: {review.turns??'—'}</p>
  <p>{t('pr_downtime_reason')}: {review.downtime_reason||'—'}</p><p>{t('inv_notes')}: {review.note||'—'}</p>
  <h3>{t(review.status==='posted'?'pr_consumed':'pr_consumption_preview')}</h3>{consumptionTable(review)}
  {confirming&&<p className="inv-message">{t('pr_confirm_post')}</p>}{error&&<p role="alert" className="inv-message">{error}</p>}
  <div className="catalog-actions">
   {review.status==='submitted'&&supervisor&&<><BtnPrimary disabled={busy} onClick={()=>confirming?action('post',review):setConfirming(true)}>{t(confirming?'pr_confirm_inventory':'pr_post_inventory')}</BtnPrimary><BtnSecondary disabled={busy} onClick={()=>action('return',review)}>{t('pr_return_draft')}</BtnSecondary></>}
   <BtnSecondary disabled={busy} onClick={()=>{setReview(null);setConfirming(false);}}>{t('close')}</BtnSecondary>
  </div>
 </div>}
 </Modal>
 </>;
}
