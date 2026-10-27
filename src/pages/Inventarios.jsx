import {allRows,recordTable} from '../dataExport.mjs';
import {uiTitle} from '../components/actionTheme.mjs';
import {AppAction} from '../components/controls';
import ShippingPacking from '../components/ShippingPacking';
import {useShippingPacking,packingError,packingTotal,allocationsFor,resolvePacking} from '../inventory/shippingPacking';
import {registerShippingPacking} from '../inventory/shippingPackingTranslations';
import {CatalogInput,CatalogSelect} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary} from '../components/controls';
import {SectionPermission} from '../RoleAccess';
import ModuleHeading from '../components/ModuleHeading';
import { usePageSection } from '../usePageSection';
import React, { useEffect, useMemo, useState } from 'react';
import { subscribeUpdates, inventoryTables } from '../realtime';
import QualityHolds from '../components/QualityHolds';
import PhysicalCounts from '../components/PhysicalCounts';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import Papa from 'papaparse';
import DepartmentNav from '../components/DepartmentNav';
import './Inventarios.css';
import '../production/reportLayout.css';

const sections = [
 ['overview','inv_overview'],['FG','inv_area_FG'],['RAW','inv_area_RAW'],['WIP','inv_area_WIP'],['quality','inv_quality'],['PACKAGING','inv_area_PACKAGING'],['dispatch','inv_dispatch'],['counts','inv_counts'],['demand','inv_demand'],
];
const areas = ['RAW', 'WIP', 'FG', 'PACKAGING', 'HOLD'];
const n = value => Number(value || 0);
const iso = value => {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const raw = String(value || '').trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw) ? raw.slice(0,10) : '';
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const clean = value => String(value ?? '').trim();
async function fileRows(file, sheetName, t) {
  if (/\.csv$/i.test(file.name)) {
    const result = Papa.parse(await file.text(), { header: true, skipEmptyLines: true });
    if (result.errors.length) throw Error(result.errors[0].message);
    return result.data;
  }
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(sheetName) || workbook.worksheets[0];
  if (!sheet) throw Error(t('inv_file_no_sheets'));
  const headers = sheet.getRow(1).values.slice(1).map(v => clean(v));
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const data = Object.fromEntries(headers.map((key, i) => [key, row.getCell(i + 1).value]));
    if (Object.values(data).some(v => v !== null && v !== '')) rows.push(data);
  });
  return rows;
}
function saveCsv(filename, rows) {
  const csv = Papa.unparse(recordTable(rows), { escapeFormulae: true });
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function unwrap(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
const choose = (items, category) => items.filter(i => i.active && (!category || i.category === category));

export default function Inventarios({ access,permissionDepartment='inventory' }) {
  const { t, i18n } = useTranslation();
  registerShippingPacking(i18n);
  const locale = i18n.language?.startsWith('ko') ? 'ko-KR' : i18n.language?.startsWith('en') ? 'en-US' : 'es-MX';
  const fmt = value => n(value).toLocaleString('en-US',{ maximumFractionDigits: 3 });
  const sectionLabel = key => t(sections.find(section => section[0] === key)?.[1] || 'inv_overview');
  const areaLabel = area => area==='SEMI'?t('rc_SEMI'):t(`inv_area_${area}`);
  const [tab, setTab] = usePageSection(permissionDepartment, 'overview', sections.map(([key])=>key));
  const [items, setItems] = useState([]);
  const [balances, setBalances] = useState([]);
  const [counts, setCounts] = useState([]);
  const [imports, setImports] = useState([]);
  const [demand, setDemand] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [finishedIdx, setFinishedIdx] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [demandFilter, setDemandFilter] = useState('');
 const emptyFilters=()=>({search:'',parts:[],stock:'all',from:'',to:''});
 const [filterDraft,setFilterDraft]=useState(emptyFilters),[filters,setFilters]=useState(emptyFilters);
 const matchPart=item=>(!filters.parts.length||filters.parts.includes(item.id))&&[item.part_number,item.part_name,item.description,item.default_location].join(' ').toLowerCase().includes(filters.search.trim().toLowerCase());
 const stockMatches=item=>matchPart(item)&&(filters.stock==='all'||filters.stock==='low'&&qty(item.id,tab)<=n(item.minimum_quantity)||filters.stock==='zero'&&qty(item.id,tab)===0||filters.stock==='negative'&&qty(item.id,tab)<0);
 const filterBar=(shipping=false)=><form className="catalog-toolbar report-toolbar inventory-filter-bar" onSubmit={e=>{e.preventDefault();setFilters({...filterDraft});}}><div className="report-filters"><CatalogInput label={uiTitle(t('search'))} placeholder={t('inv_filter_hint')} value={filterDraft.search} onChange={e=>setFilterDraft(v=>({...v,search:e.target.value}))}/><CatalogSelect multi label={uiTitle(t('inv_part'))} value={filterDraft.parts} onChange={parts=>setFilterDraft(v=>({...v,parts}))} options={(shipping?items.filter(i=>i.category==='FG'):stockItems(tab)).map(i=>({value:i.id,label:i.part_number+' · '+(i.part_name||i.description||'')}))}/>{shipping?<><CatalogInput type="date" label={uiTitle(t('inv_filter_from'))} value={filterDraft.from} onChange={e=>setFilterDraft(v=>({...v,from:e.target.value}))}/><CatalogInput type="date" label={uiTitle(t('inv_filter_to'))} value={filterDraft.to} onChange={e=>setFilterDraft(v=>({...v,to:e.target.value}))}/></>:<CatalogSelect label={uiTitle(t('inv_stock_filter'))} value={filterDraft.stock} onChange={stock=>setFilterDraft(v=>({...v,stock}))} options={['all','low','zero','negative'].map(value=>({value,label:t('inv_stock_'+value)}))}/>}</div><div className="report-actions"><BtnPrimary intent="neutral" type="submit">{t('search')}</BtnPrimary><BtnSecondary intent="neutral" type="button" onClick={()=>{setFilterDraft(emptyFilters());setFilters(emptyFilters());}}>{t('clear_filters')}</BtnSecondary></div></form>;
  const [demandMode, setDemandMode] = useState('all');
 const [demandParts,setDemandParts]=useState([]);
  const [selectedIdx, setSelectedIdx] = useState('');
  const [dispatchDate, setDispatchDate] = useState(today());
  const packing=useShippingPacking(supabase,selectedIdx);
  const [pendingParts, setPendingParts] = useState(new Set());
  const [countedParts, setCountedParts] = useState(new Set());
  useEffect(() => { setMessage(''); }, [i18n.language]);

  const can = (dept, supervisor = false) => access.admin || access.memberships.some(m => m.department === dept && (!supervisor || m.role === 'supervisor'));
  async function refresh() {
    const [i, b, c, imp, ship, disp, lines, pendingRows] = await Promise.all([
      unwrap(supabase.from('inventory_items').select('id,producto_id,part_number,part_name,description,productos(nombre,descripcion),category,uom,minimum_quantity,responsible_department,default_location,active').order('part_number')),
      unwrap(supabase.from('inventory_balances').select('item_id,area,quantity')),
      allRows(()=>supabase.from('inventory_counts').select('*,inventory_count_lines(*)').order('submitted_at', { ascending: false }).order('id')),
      unwrap(supabase.from('inventory_demand_imports').select('*').order('imported_at', { ascending: false }).limit(10)),
      can('shipping',true) ? unwrap(supabase.from('actividades').select('id,nombre').ilike('nombre','load')) : Promise.resolve([]),
      unwrap(supabase.from('inventory_dispatches').select('*').order('confirmed_at', { ascending: false }).limit(50)),
      can('shipping',true) ? unwrap(supabase.from('shipping_lines').select('id,idx,producto,cantidad_cajas,productos(part_number,nombre,cantidad_por_caja_retornable,cantidad_por_caja_expendable)').order('created_at', { ascending: false }).limit(500)) : Promise.resolve([]),
      unwrap(supabase.from('inventory_reference_rows').select('part_number,status').eq('batch_key','production-files-2026-10-07').eq('kind','inventory').limit(1000)),
    ]);
    const approvedRawParts=new Set((c||[]).filter(count=>count.area==='RAW'&&count.status==='approved').flatMap(count=>count.inventory_count_lines.map(line=>i.find(item=>item.id===line.item_id)?.part_number)));
    setPendingParts(new Set((pendingRows || []).filter(row => ['unit_conflict','missing_count'].includes(row.status)&&!approvedRawParts.has(row.part_number)).map(row => row.part_number)));
    setCountedParts(new Set([...(pendingRows || []).filter(row => row.status === 'loaded').map(row => row.part_number),...approvedRawParts]));
    setItems((i || []).map(row=>({...row,part_name:row.productos?.nombre||row.part_name,description:row.productos?.descripcion??row.description}))); setBalances(b || []); setCounts(c || []);
    setImports(imp || []); setDispatches(disp || []);
    setShippingLines(lines || []);
    if (ship?.[0]?.id && can('shipping',true)) {
      const completed = await unwrap(supabase.from('actividades_realizadas').select('idx')
        .eq('actividad',ship[0].id).eq('estado','finalizada').order('hora_fin',{ascending:false}).limit(500));
      setFinishedIdx([...new Set((completed||[]).map(r=>r.idx))]);
    }
  }
  useEffect(() => { const load=()=>refresh().catch(e=>setMessage(e.message));load();return subscribeUpdates(supabase,'inventory-web',inventoryTables,load); }, []);
  async function act(fn, success = t('global_saved')) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await fn(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(false); }
  }
  const qty = (id, area) => n(balances.find(b => b.item_id === id && b.area === (area==='SEMI'?'WIP':area))?.quantity);
  const stockItems = area => area === 'WIP' ? items.filter(i=>['FG','SEMI'].includes(i.category)) : choose(items, area === 'WIP' ? 'FG' : area === 'PACKAGING' ? 'PACKAGING' : area === 'RAW' ? 'RAW' : area === 'FG' ? 'FG' : null);
  const verifiedAreas = new Set(counts.filter(c => c.status === 'approved').map(c => c.area));
  const warnings = items.filter(i => i.active &&
    (verifiedAreas.has(i.category==='SEMI'?'WIP':i.category) || balances.some(b => b.item_id === i.id && b.area === (i.category==='SEMI'?'WIP':i.category))) &&
    qty(i.id, i.category) <= n(i.minimum_quantity));
  const currentImport = imports.find(i => i.status === 'active');
  const canCatalog = can('inventory', true);

  async function importDemand(file) {
    const rows = await fileRows(file, 'Raw', t);
    if (!rows.length) throw Error(t('inv_file_empty'));
    const normalized = rows.map((r, index) => {
      const line = { po: clean(r['PO Number']), po_line: clean(r['PO Line #']),
        part_number: clean(r['Part Number']), description: clean(r['Part Description']),
        destination: clean(r['Ship To Location']), ship_date: iso(r['Ship Date']),
        quantity: Number(r['Open Quantity']), uom: clean(r['Unit of Measure']) || 'EA',
        release_version: clean(r['Release Version']), release_date: iso(r['Release Date']) || null };
      if (!line.po || !line.po_line || !line.part_number || !line.ship_date ||
        !Number.isFinite(line.quantity) || line.quantity < 0) throw Error(t('inv_file_invalid_row', { row: index + 2 }));
      return line;
    });
    const keys = normalized.map(r => [r.po,r.po_line,r.part_number,r.ship_date].join('|'));
    if (new Set(keys).size !== keys.length) throw Error(t('inv_file_duplicates'));
    const bytes = await file.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    let backlogCutoff = '';
    if (/\.xlsx$/i.test(file.name)) {
      const { default: ExcelJS } = await import('exceljs');
      const matrixBook = new ExcelJS.Workbook();
      await matrixBook.xlsx.load(bytes);
      const matrix = matrixBook.getWorksheet('Matrix');
      if (matrix) for (let col = 11; col <= matrix.columnCount; col++) {
        if (clean(matrix.getRow(2).getCell(col).value).toUpperCase() === 'BACKLOG')
          backlogCutoff = iso(matrix.getRow(3).getCell(col).value);
      }
    }
    let previous = await unwrap(supabase.from('inventory_demand_imports').select('id,status').eq('file_fingerprint',hash).maybeSingle());
    if (previous?.status === 'active' || previous?.status === 'superseded') throw Error(t('inv_file_already_imported'));
    const batch = previous || await unwrap(supabase.from('inventory_demand_imports')
      .insert({ file_name: file.name, file_fingerprint: hash, expected_rows: normalized.length,
        backlog_cutoff:backlogCutoff || null }).select('id').single());
    for (let index = 0; index < normalized.length; index += 200) {
      await unwrap(supabase.rpc('inventory_append_demand', { p_import: batch.id, p_lines: normalized.slice(index,index + 200) }));
      setMessage(t('inv_import_progress', { done: Math.min(index + 200,normalized.length), total: normalized.length }));
    }
    await unwrap(supabase.rpc('inventory_activate_demand', { p_import: batch.id }));
  }
  async function searchDemand() {
    if (!currentImport) { setDemand([]); return; }
    let query = supabase.from('inventory_demand_lines')
      .select('po,po_line,part_number,description,destination,ship_date,quantity,uom')
      .eq('import_id',currentImport.id).order('ship_date').limit(500);
    if(demandParts.length)query=query.in('part_number',demandParts);
    if (demandFilter.trim()) query = query.ilike('part_number',`%${demandFilter.trim()}%`);
    if (currentImport.backlog_cutoff && demandMode==='backlog')
      query = query.lte('ship_date',currentImport.backlog_cutoff);
    if (currentImport.backlog_cutoff && demandMode==='future')
      query = query.gt('ship_date',currentImport.backlog_cutoff);
    setDemand(await unwrap(query));
  }
  useEffect(() => { searchDemand().catch(e => setMessage(e.message)); }, [currentImport?.id]);

  const pendingIdx = useMemo(() => [...new Set(shippingLines.map(l => l.idx))]
    .filter(idx => finishedIdx.includes(idx) && !dispatches.some(d => d.idx === idx)), [shippingLines,dispatches,finishedIdx]);
  const selectedLines = shippingLines.filter(l => l.idx === selectedIdx);


  return <><div className="module-department-nav">
    <ModuleHeading title={uiTitle(t(permissionDepartment==='quality'?'global_quality':'inv_title'))}/>
    <DepartmentNav department={permissionDepartment} items={(permissionDepartment==='quality'?sections.filter(([key])=>['overview','quality','counts'].includes(key)):sections).map(([key,label])=>({key,label:t(label)}))} value={tab} onChange={key=>{setTab(key);setMessage('');setFilterDraft(emptyFilters());setFilters(emptyFilters());}} label={uiTitle(t('inv_section'))}/></div><SectionPermission department={permissionDepartment} activity={tab}><main className="inv-page module-surface">
    <div className="inv-layout">
      <div className="inv-main">
    {!!message && <p role="status" className="inv-message">{message}</p>}

    {tab === 'overview' && <div className="inv-grid">
      {areas.map(area => <section key={area} className="inv-card"><h2>{areaLabel(area)}</h2>
        <strong>{balances.filter(b => b.area === area).length}</strong><small>{t('inv_parts_with_movements')}</small></section>)}
      <section className="inv-card inv-wide"><h2>{uiTitle(t('inv_alerts'))}</h2>
        {!counts.some(c => c.status === 'approved') && <p>{t('inv_initial_count_pending')}</p>}
        {!warnings.length ? <p>{t('inv_no_low_stock')}</p> :
          <div className="inv-table-wrap"><table><thead><tr><th>{uiTitle(t('inv_part'))}</th><th>{uiTitle(t('inv_area'))}</th><th>{uiTitle(t('inv_balance'))}</th><th>{uiTitle(t('inv_minimum'))}</th><th>{uiTitle(t('inv_status'))}</th></tr></thead><tbody>
          {warnings.map(i => <tr key={i.id}><td>{i.part_number}</td><td>{areaLabel(i.category)}</td>
            <td className="inv-negative">{fmt(qty(i.id,i.category))}</td><td>{fmt(i.minimum_quantity)}</td>
            <td>{t(qty(i.id,i.category) < 0 ? 'inv_negative' : qty(i.id,i.category) === 0 ? 'inv_out_of_stock' : 'inv_low_stock')}</td></tr>)}</tbody></table></div>}
      </section></div>}

    {['RAW','WIP','FG','PACKAGING'].includes(tab) && <section className="inv-card">
      <h2>{sectionLabel(tab)}</h2>{tab==='WIP'&&<p className="inv-muted">{t('inv_semi_hint')}</p>}{filterBar()}
      <p className="inv-muted">{t('inv_negative_hint')}</p>
      <div className="inv-table-wrap"><table><thead><tr><th>{uiTitle(t('inv_part'))}</th>{tab==='FG'&&<th>{uiTitle(t('name'))}</th>}<th>{uiTitle(t('inv_description'))}</th><th>{uiTitle(t('inv_unit'))}</th><th>{uiTitle(t('rw_available'))}</th><th>{uiTitle(t('rw_quarantine'))}</th><th>{uiTitle(t('inv_minimum'))}</th><th>{uiTitle(t('inv_location'))}</th>{tab==='RAW'&&<th>{uiTitle(t('inv_notes'))}</th>}</tr></thead>
        <tbody>{stockItems(tab).filter(stockMatches).map(i => <tr key={i.id}><td>{i.part_number}</td>{tab==='FG'&&<td>{i.part_name||'—'}</td>}<td>{i.description}{tab==='WIP'&&<small>{t('rc_'+i.category)}</small>}</td><td>{i.uom}</td>
          <td className={qty(i.id,tab)<0 ? 'inv-negative' : qty(i.id,tab)<=n(i.minimum_quantity) ? 'inv-low' : ''}>{fmt(qty(i.id,tab))}</td><td>{fmt(qty(i.id,'HOLD'))}</td>
          <td>{fmt(i.minimum_quantity)}</td><td>{i.default_location || '—'}</td>{tab==='RAW'&&<td>{pendingParts.has(i.part_number)?t(qty(i.id,tab)===0?'inv_ref_missing_count':'inv_ref_balance_pending'):!countedParts.has(i.part_number)&&qty(i.id,tab)===0?t('inv_ref_missing_count'):'—'}</td>}</tr>)}</tbody></table></div>
      {tab==='WIP'&&!stockItems('WIP').length&&<p className="inv-muted">{t('inv_wip_empty')}</p>}
    </section>}
    {tab === 'demand' && <section className="inv-card"><h2>{uiTitle(t('inv_demand_title'))}</h2>
      <p>{t('inv_demand_intro')}</p>
      <p>{t('inv_current_file')}: <strong className="inv-inline-strong">{currentImport?.file_name || t('inv_none')}</strong> {currentImport ? `(${t('inv_rows_backlog', { count: currentImport.expected_rows, date: currentImport.backlog_cutoff || t('inv_no_matrix') })})` : ''}</p>
      {canCatalog && <label className="inv-file">{t('inv_import_raw')} <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; if (file) act(() => importDemand(file),t('inv_demand_updated')); e.target.value='';
      }}/></label>}
      <form className="inv-form" onSubmit={e => {e.preventDefault();searchDemand().catch(error=>setMessage(error.message));}}>
        <CatalogSelect multi label={uiTitle(t('inv_part'))} value={demandParts} onChange={setDemandParts} options={[...new Map(items.filter(i=>['FG','SEMI'].includes(i.category)).map(i=>[i.part_number,{value:i.part_number,label:i.part_number+' · '+(i.part_name||i.description||'')}])).values()]}/><input placeholder={t('inv_filter_part')} value={demandFilter} onChange={e=>setDemandFilter(e.target.value)}/>
        <select value={demandMode} onChange={e=>setDemandMode(e.target.value)}>
          <option value="all">{t('inv_all')}</option><option value="backlog">{t('inv_backlog')}</option><option value="future">{t('inv_future_demand')}</option></select>
        <AppAction intent="neutral">{t('inv_search')}</AppAction></form>
      <p className="inv-muted">{t('inv_max_500')}</p>
      <div className="inv-table-wrap"><table><thead><tr><th>{uiTitle(t('inv_ship_date'))}</th><th>{uiTitle(t('inv_po_line'))}</th><th>{uiTitle(t('inv_part'))}</th><th>{uiTitle(t('inv_destination'))}</th><th>{uiTitle(t('inv_quantity'))}</th><th>{uiTitle(t('inv_catalog'))}</th></tr></thead><tbody>
        {demand.map((r,index) => <tr key={index}><td>{r.ship_date}</td><td>{r.po} / {r.po_line}</td><td>{r.part_number}</td><td>{r.destination}</td><td>{fmt(r.quantity)} {r.uom}</td>
          <td>{t(items.some(i=>i.part_number===r.part_number) ? 'inv_linked' : 'inv_review_part')}</td></tr>)}</tbody></table></div></section>}

    {tab === 'counts' && <PhysicalCounts items={items} balances={balances} counts={counts} access={access} fileRows={fileRows} saveCsv={saveCsv} onChanged={refresh}/>}
    {tab === 'dispatch' && <section className="inv-card"><h2>{uiTitle(t('inv_dispatch_title'))}</h2>{filterBar(true)}
      <p>{t('inv_dispatch_intro')}</p>
      {can('shipping',true) && <><div className="inv-form"><select value={selectedIdx} onChange={e=>{setSelectedIdx(e.target.value);}}>
        <option value="">{t('inv_select_idx')}</option>{pendingIdx.map(idx=><option key={idx}>{idx}</option>)}</select>
        <input type="date" max={today()} value={dispatchDate} onChange={e=>setDispatchDate(e.target.value)}/></div>
        {!!selectedIdx && <><ShippingPacking model={packing} disabled={busy}/>
          {packing.context?.lines.map(line=><p key={line.id}>{line.product.part_number}: {fmt(packingTotal(resolvePacking(line,allocationsFor(line,packing.draft))))} {t('inv_pieces_deducted')}</p>)}
          <AppAction intent="confirm" disabled={busy||packing.loading||!packing.valid} onClick={()=>act(async()=>{
            try {
              const saved=await packing.save();
              await unwrap(supabase.rpc('shipping_confirm_packing',{p_idx:selectedIdx,p_date:dispatchDate,p_lines:saved.lines.map(line=>({line_id:line.id,saved_at:line.saved_at}))}));
              setSelectedIdx('');
            } catch(error){throw Error(packingError(error,t));}
          },t('inv_shipment_confirmed'))}>{t('inv_confirm_idx')}</AppAction></>}</>}
      <h3>{uiTitle(t('inv_confirmed_shipments'))}</h3>{dispatches.filter(d=>(!filters.from||d.ship_date>=filters.from)&&(!filters.to||d.ship_date<=filters.to)&&(!filters.parts.length||shippingLines.some(l=>l.idx===d.idx&&filters.parts.includes(items.find(i=>i.part_number===l.productos?.part_number)?.id)))&&[d.idx,d.ship_date,...shippingLines.filter(l=>l.idx===d.idx).map(l=>l.productos?.part_number)].join(' ').toLowerCase().includes(filters.search.toLowerCase())).map(d=><p key={d.idx}>{d.ship_date} · IDX {d.idx} · {t('inv_confirmed_at')} {new Date(d.confirmed_at).toLocaleString(locale)}</p>)}</section>}

    {tab === 'quality' && <section className="inv-card"><h2>{uiTitle(t('inv_quality_title'))}</h2>
      <QualityHolds items={items} access={access}/></section>}
      </div>
    </div>
  </main></SectionPermission></>;
}

