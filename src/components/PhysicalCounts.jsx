import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import { CatalogInput, CatalogSelect } from './SharedCatalogFields';
import { BtnPrimary, BtnSecondary, BtnDanger, TablePagination } from './controls';
import '../pages/Catalogos.css';
import { parsePhysicalCount } from '../inventory/physicalCounts';
const unwrap = async q => {const {data,error}=await q;if(error)throw error;return data;};
export default function PhysicalCounts({items,balances,counts,access,fileRows,saveCsv,onChanged}){
 const {t,i18n}=useTranslation();
 const can=(dept,supervisor=false)=>access.admin||access.memberships.some(m=>m.department===dept&&(!supervisor||m.role==='supervisor'));
 const [area,setArea]=useState('RAW'),[department,setDepartment]=useState(can('receiving')?'receiving':'inventory');
 const [physical,setPhysical]=useState({}),[search,setSearch]=useState(''),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25);
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[onlyEntered,setOnlyEntered]=useState(false),[report,setReport]=useState(null);
 const qty=id=>Number(balances.find(b=>b.item_id===id&&b.area===area)?.quantity||0);
 const fmt=v=>Number(v).toLocaleString(i18n.language,{maximumFractionDigits:6});
 const category=area==='WIP'?'SEMI':area;
 const countable=items.filter(i=>i.active&&(area==='HOLD'?balances.some(b=>b.item_id===i.id&&b.area==='HOLD'):i.category===category)&&(department==='inventory'||(area==='HOLD'?department==='quality':area==='WIP'?department==='production':i.responsible_department===department)));
 const entered=countable.filter(i=>physical[i.id]!==undefined&&physical[i.id]!=='');
 const filtered=countable.filter(i=>(!onlyEntered||physical[i.id]!==undefined&&physical[i.id]!=='')&&[i.part_number,i.part_name,i.description].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 const currentPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)));
 async function act(fn,success){if(busy)return;setBusy(true);setMessage('');setError('');try{await fn();await onChanged();setMessage(success);}catch(e){setError(e.message);}finally{setBusy(false);}}
 function changeArea(next){if(Object.keys(physical).length&&!window.confirm(t('count_discard')))return;setArea(next);setPhysical({});setPage(1);setMessage('');setError('');if(can('inventory'))setDepartment('inventory');else setDepartment(next==='FG'?'shipping':next==='WIP'?'production':next==='HOLD'?'quality':'receiving');}
 async function upload(file){
  const source=await fileRows(file,undefined,t),next=parsePhysicalCount(source,countable,t);
  setPhysical(next);setOnlyEntered(true);setPage(1);setMessage(t('inv_count_rows_loaded',{count:Object.keys(next).length}));
 }
 return <section className="inv-card catalog-page">
  <h2>{t('inv_counts_title')}</h2><p className="inv-muted">{t('count_intro')}</p>
  <div className="catalog-fields">
   <CatalogSelect disabled={busy} label={t('inv_area')} value={area} onChange={changeArea} options={['RAW','FG','PACKAGING','WIP','HOLD'].map(a=>({value:a,label:t('inv_area_'+a)}))}/>
   <CatalogSelect disabled={busy} label={t('inv_department')} value={department} onChange={v=>{if(Object.keys(physical).length&&!window.confirm(t('count_discard')))return;setDepartment(v);setPhysical({});setPage(1);}} options={['inventory','receiving','shipping','production','quality'].filter(d=>can(d)).map(d=>({value:d,label:t('inv_dept_'+d)}))}/>
   <CatalogInput label={t('search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
  </div>
  <div className="catalog-actions">
   <BtnSecondary disabled={busy} onClick={()=>saveCsv('physical_count_template.csv',countable.map(i=>({'Part Number':i.part_number,Name:i.part_name||i.description,Unit:i.uom,'Physical Quantity':''})))}>{t('inv_download_template')}</BtnSecondary>
   <label className="inv-file">{t('inv_upload_count')}<input type="file" accept=".csv,.xlsx" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)act(()=>upload(f),t('count_preview_ready'));}}/></label>
   <BtnSecondary disabled={busy} onClick={()=>{if(entered.length&&!window.confirm(t('count_discard')))return;setPhysical({});setOnlyEntered(false);}}>{t('count_clear')}</BtnSecondary>
   <label className="catalog-checkbox"><input type="checkbox" checked={onlyEntered} onChange={e=>{setOnlyEntered(e.target.checked);setPage(1);}}/>{t('count_only_entered')}</label>
  </div>
  <p>{t('count_progress',{count:entered.length,total:countable.length})}</p>
  {message&&<p role="status" className="inv-message">{message}</p>}{error&&<p role="alert" className="inv-message">{error}</p>}
  <div className="table-wrap catalog-table-scroll"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('name')}</th><th>{t('inv_unit')}</th><th>{t('inv_expected')}</th><th>{t('inv_physical')}</th><th>{t('inv_difference')}</th></tr></thead><tbody>
   {filtered.slice((currentPage-1)*pageSize,currentPage*pageSize).map(i=><tr key={i.id}><td>{i.part_number}</td><td>{i.part_name||i.description}</td><td>{i.uom}</td><td>{fmt(qty(i.id))}</td>
    <td><input aria-label={t('inv_physical')+' '+i.part_number} disabled={busy} className="count-quantity" type="number" min="0" step="any" placeholder="—" value={physical[i.id]??''} onChange={e=>setPhysical({...physical,[i.id]:e.target.value})}/></td>
    <td className={physical[i.id]!==undefined&&physical[i.id]!==''&&Number(physical[i.id])-qty(i.id)<0?'inv-negative':''}>{physical[i.id]===undefined||physical[i.id]===''?'—':fmt(Number(physical[i.id])-qty(i.id))}</td></tr>)}
   {!filtered.length&&<tr><td colSpan="6">{t('no_results_found')}</td></tr>}
  </tbody></table><TablePagination totalRows={filtered.length} page={currentPage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={s=>{setPageSize(s);setPage(1);}}/></div>
  <div className="catalog-actions"><BtnPrimary disabled={busy||!can(department)||!entered.length} onClick={()=>act(async()=>{
   const lines=entered.map(i=>({item_id:i.id,physical_quantity:Number(physical[i.id])}));
   if(lines.some(l=>!Number.isFinite(l.physical_quantity)||l.physical_quantity<0))throw Error(t('inv_review_quantities'));
   await unwrap(supabase.rpc('inventory_submit_count',{p_department:department,p_area:area,p_lines:lines}));
   setPhysical({});setOnlyEntered(false);
  },t('inv_count_submitted'))}>{t('inv_submit_count')}</BtnPrimary></div>
  <h3>{t('inv_count_reports')}</h3>
  <div className="table-wrap"><table className="table"><thead><tr><th>{t('inv_day')}</th><th>{t('inv_area')}</th><th>{t('inv_department')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>
   {counts.map(c=><React.Fragment key={c.id}><tr><td>{new Date(c.counted_at||c.submitted_at).toLocaleString(i18n.language)}</td><td>{t('inv_area_'+c.area)}</td><td>{t('inv_dept_'+c.department)}</td><td>{t('inv_status_'+c.status)}</td><td>
    <BtnSecondary onClick={()=>setReport(report===c.id?null:c.id)}>{t('count_view')}</BtnSecondary>
    <BtnSecondary onClick={()=>saveCsv('physical_count_'+c.id+'.csv',c.inventory_count_lines.map(l=>({'Part Number':items.find(i=>i.id===l.item_id)?.part_number,'Expected Quantity':l.expected_quantity,'Physical Quantity':l.physical_quantity,Difference:Number(l.physical_quantity)-Number(l.expected_quantity)})))}>{t('inv_download_report')}</BtnSecondary>
    {c.status==='submitted'&&can(c.department,true)&&<><BtnPrimary disabled={busy} onClick={()=>{if(window.confirm(t('count_confirm_apply')))act(()=>unwrap(supabase.rpc('inventory_review_count',{p_count:c.id,p_approve:true,p_note:t('inv_mobile_approved_note')})),t('inv_count_approved'));}}>{t('inv_approve_apply')}</BtnPrimary>
     <BtnDanger disabled={busy} onClick={()=>act(()=>unwrap(supabase.rpc('inventory_review_count',{p_count:c.id,p_approve:false,p_note:t('inv_mobile_rejected_note')})),t('inv_count_rejected'))}>{t('inv_reject')}</BtnDanger></>}
   </td></tr>
   {report===c.id&&<tr><td colSpan="5"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('inv_expected')}</th><th>{t('inv_physical')}</th><th>{t('inv_difference')}</th></tr></thead><tbody>
    {c.inventory_count_lines.map(l=><tr key={l.item_id}><td>{items.find(i=>i.id===l.item_id)?.part_number}</td><td>{fmt(l.expected_quantity)}</td><td>{fmt(l.physical_quantity)}</td><td>{fmt(Number(l.physical_quantity)-Number(l.expected_quantity))}</td></tr>)}
   </tbody></table></td></tr>}
   </React.Fragment>)}
  </tbody></table></div>
 </section>;
}
