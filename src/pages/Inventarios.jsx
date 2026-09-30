import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import Papa from 'papaparse';
import DepartmentNav from '../components/DepartmentNav';
import './Inventarios.css';

const sections = [
  ['overview', 'inv_overview'], ['RAW', 'inv_area_RAW'], ['WIP', 'inv_area_WIP'],
  ['FG', 'inv_area_FG'], ['bom', 'inv_bom'], ['demand', 'inv_demand'],
  ['PACKAGING', 'inv_area_PACKAGING'], ['quality', 'inv_quality'],
  ['counts', 'inv_counts'], ['dispatch', 'inv_dispatch'], ['catalog', 'inv_catalog'],
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
  const csv = Papa.unparse(rows, { escapeFormulae: true });
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

export default function Inventarios({ access }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('ko') ? 'ko-KR' : i18n.language?.startsWith('en') ? 'en-US' : 'es-MX';
  const fmt = value => n(value).toLocaleString(locale, { maximumFractionDigits: 3 });
  const sectionLabel = key => t(sections.find(section => section[0] === key)?.[1] || 'inv_overview');
  const areaLabel = area => t(`inv_area_${area}`);
  const departmentLabel = department => t(`inv_dept_${department}`);
  const statusLabel = status => t(`inv_status_${status}`);
  const [tab, setTab] = useState('overview');
  const [items, setItems] = useState([]);
  const [balances, setBalances] = useState([]);
  const [counts, setCounts] = useState([]);
  const [reports, setReports] = useState([]);
  const [boms, setBoms] = useState([]);
  const [imports, setImports] = useState([]);
  const [demand, setDemand] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [finishedIdx, setFinishedIdx] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState({ item: '', delta: '', note: '', lot: '', location: '', date: today() });
  const [itemForm, setItemForm] = useState({ part_number: '', description: '', category: 'RAW', uom: 'EA', minimum_quantity: 0, responsible_department: 'inventory', default_location: '' });
  const [editingItem, setEditingItem] = useState(null);
  const [production, setProduction] = useState({ item: '', date: today(), good: '', waste: '', wip: '0', note: '' });
  const [bomItem, setBomItem] = useState('');
  const [bomId, setBomId] = useState('');
  const [bomLine, setBomLine] = useState({ ingredient: '', quantity: '', waste: '0' });
  const [countArea, setCountArea] = useState('FG');
  const [countDepartment, setCountDepartment] = useState('inventory');
  const [physical, setPhysical] = useState({});
  const [demandFilter, setDemandFilter] = useState('');
  const [demandMode, setDemandMode] = useState('all');
  const [selectedIdx, setSelectedIdx] = useState('');
  const [dispatchDate, setDispatchDate] = useState(today());
  const [perBox, setPerBox] = useState({});
  useEffect(() => { setMessage(''); }, [i18n.language]);

  const can = (dept, supervisor = false) => access.admin || access.memberships.some(m => m.department === dept && (!supervisor || m.role === 'supervisor'));
  async function refresh() {
    const [i, b, c, p, bom, imp, ship, disp, lines] = await Promise.all([
      unwrap(supabase.from('inventory_items').select('id,producto_id,part_number,description,category,uom,minimum_quantity,responsible_department,default_location,active').order('part_number')),
      unwrap(supabase.from('inventory_balances').select('item_id,area,quantity')),
      unwrap(supabase.from('inventory_counts').select('*,inventory_count_lines(*)').order('submitted_at', { ascending: false }).limit(50)),
      unwrap(supabase.from('inventory_production_reports').select('*').order('created_at', { ascending: false }).limit(30)),
      unwrap(supabase.from('inventory_boms').select('*,inventory_bom_lines(*)').order('version', { ascending: false })),
      unwrap(supabase.from('inventory_demand_imports').select('*').order('imported_at', { ascending: false }).limit(10)),
      can('shipping',true) ? unwrap(supabase.from('actividades').select('id,nombre').ilike('nombre','load')) : Promise.resolve([]),
      unwrap(supabase.from('inventory_dispatches').select('*').order('confirmed_at', { ascending: false }).limit(50)),
      can('shipping',true) ? unwrap(supabase.from('shipping_lines').select('id,idx,producto,cantidad_cajas,productos(part_number,nombre,cantidad_por_caja_retornable,cantidad_por_caja_expendable)').order('created_at', { ascending: false }).limit(500)) : Promise.resolve([]),
    ]);
    setItems(i || []); setBalances(b || []); setCounts(c || []); setReports(p || []);
    setBoms(bom || []); setImports(imp || []); setDispatches(disp || []);
    setShippingLines(lines || []);
    if (ship?.[0]?.id && can('shipping',true)) {
      const completed = await unwrap(supabase.from('actividades_realizadas').select('idx')
        .eq('actividad',ship[0].id).eq('estado','finalizada').order('hora_fin',{ascending:false}).limit(500));
      setFinishedIdx([...new Set((completed||[]).map(r=>r.idx))]);
    }
  }
  useEffect(() => { refresh().catch(e => setMessage(e.message)); }, []);
  async function act(fn, success = t('global_saved')) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await fn(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(false); }
  }
  const qty = (id, area) => n(balances.find(b => b.item_id === id && b.area === area)?.quantity);
  const stockItems = area => choose(items, area === 'WIP' ? 'FG' : area === 'PACKAGING' ? 'PACKAGING' : area === 'RAW' ? 'RAW' : area === 'FG' ? 'FG' : null);
  const verifiedAreas = new Set(counts.filter(c => c.status === 'approved').map(c => c.area));
  const warnings = items.filter(i => i.active &&
    (verifiedAreas.has(i.category) || balances.some(b => b.item_id === i.id && b.area === i.category)) &&
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
  const countable = stockItems(countArea).filter(i => countArea === 'WIP'
    ? countDepartment === 'production'
    : countArea === 'HOLD' ? countDepartment === 'quality' && balances.some(b => b.item_id === i.id && b.area === 'HOLD')
      : i.responsible_department === countDepartment);

  return <main className="inv-page">
    <header className="inv-head"><div><small>DAEHAN APP · {t('inv_title')}</small><h1>{t('inv_title')}</h1></div><button onClick={() => act(async () => {}, t('inv_updated'))}>{t('inv_refresh')}</button></header>
    <DepartmentNav items={sections.map(([key,label])=>({key,label:t(label)}))} value={tab} onChange={key=>{setTab(key);setMessage('');}} label={t('inv_section')}/>
    <div className="inv-layout">
      <div className="inv-main">
    {!!message && <p role="status" className="inv-message">{message}</p>}

    {tab === 'overview' && <div className="inv-grid">
      {areas.map(area => <section key={area} className="inv-card"><h2>{areaLabel(area)}</h2>
        <strong>{balances.filter(b => b.area === area).length}</strong><small>{t('inv_parts_with_movements')}</small></section>)}
      <section className="inv-card inv-wide"><h2>{t('inv_alerts')}</h2>
        {!counts.some(c => c.status === 'approved') && <p>{t('inv_initial_count_pending')}</p>}
        {!warnings.length ? <p>{t('inv_no_low_stock')}</p> :
          <div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_area')}</th><th>{t('inv_balance')}</th><th>{t('inv_minimum')}</th><th>{t('inv_status')}</th></tr></thead><tbody>
          {warnings.map(i => <tr key={i.id}><td>{i.part_number}</td><td>{areaLabel(i.category)}</td>
            <td className="inv-negative">{fmt(qty(i.id,i.category))}</td><td>{fmt(i.minimum_quantity)}</td>
            <td>{t(qty(i.id,i.category) < 0 ? 'inv_negative' : qty(i.id,i.category) === 0 ? 'inv_out_of_stock' : 'inv_low_stock')}</td></tr>)}</tbody></table></div>}
      </section></div>}

    {['RAW','WIP','FG','PACKAGING'].includes(tab) && <section className="inv-card">
      <h2>{sectionLabel(tab)}</h2>
      <p className="inv-muted">{t('inv_negative_hint')}</p>
      <div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_description')}</th><th>{t('inv_unit')}</th><th>{t('inv_balance')}</th><th>{t('inv_minimum')}</th><th>{t('inv_location')}</th></tr></thead>
        <tbody>{stockItems(tab).map(i => <tr key={i.id}><td>{i.part_number}</td><td>{i.description}</td><td>{i.uom}</td>
          <td className={qty(i.id,tab)<0 ? 'inv-negative' : qty(i.id,tab)<=n(i.minimum_quantity) ? 'inv-low' : ''}>{fmt(qty(i.id,tab))}</td>
          <td>{fmt(i.minimum_quantity)}</td><td>{i.default_location || '—'}</td></tr>)}</tbody></table></div>
      {(tab === 'RAW' || tab === 'PACKAGING' || tab === 'WIP') && can(tab === 'WIP' ? 'production' : 'inventory') &&
        <form className="inv-form" onSubmit={e => { e.preventDefault(); act(async () => {
          const delta=Number(move.delta);
          await unwrap(supabase.rpc('inventory_post_movement', { p_item: move.item,p_area:tab,p_delta:delta,
            p_kind:tab==='WIP'?(delta>0?'WIP_IN':'WIP_OUT'):(delta>0?'RECEIPT':'CONSUMPTION'),
            p_note:move.note,p_location:move.location,p_lot:move.lot,p_date:move.date }));
          setMove({ ...move,delta:'',note:'' });
        }, t('inv_movement_saved')); }}>
          <h3>{t('inv_record_movement')}</h3><select required value={move.item} onChange={e => setMove({...move,item:e.target.value})}><option value="">{t('inv_select_part')}</option>
            {stockItems(tab).map(i => <option key={i.id} value={i.id}>{i.part_number} · {i.description}</option>)}</select>
          <input type="number" step="any" required value={move.delta} placeholder={t('inv_signed_change')} onChange={e => setMove({...move,delta:e.target.value})}/>
          <input type="date" required value={move.date} onChange={e => setMove({...move,date:e.target.value})}/>
          <input placeholder={t('inv_lot')} value={move.lot} onChange={e => setMove({...move,lot:e.target.value})}/>
          <input placeholder={t('inv_location')} value={move.location} onChange={e => setMove({...move,location:e.target.value})}/>
          <input required placeholder={t('inv_reason')} value={move.note} onChange={e => setMove({...move,note:e.target.value})}/>
          <button disabled={busy}>{t('inv_save_movement')}</button>
        </form>}
      {tab === 'WIP' && can('production') && <form className="inv-form" onSubmit={e => {e.preventDefault();act(async () => {
        await unwrap(supabase.rpc('inventory_record_production', { p_item:production.item,p_date:production.date,
          p_good:Number(production.good),p_waste:Number(production.waste),p_wip_completed:Number(production.wip),p_note:production.note }));
        setProduction({...production,good:'',waste:'',wip:'0',note:''});
      },boms.some(b=>b.finished_item_id===production.item && b.active)
        ? t('inv_production_bom_saved') : t('inv_production_no_bom'));}}>
        <h3>{t('inv_daily_production')}</h3>
        <select required value={production.item} onChange={e => setProduction({...production,item:e.target.value})}><option value="">{t('inv_finished_product')}</option>
          {choose(items,'FG').map(i => <option key={i.id} value={i.id}>{i.part_number} · {i.description}</option>)}</select>
        <input type="date" required value={production.date} onChange={e => setProduction({...production,date:e.target.value})}/>
        <input type="number" min="0" step="any" required placeholder={t('inv_good_pieces')} value={production.good} onChange={e => setProduction({...production,good:e.target.value})}/>
        <input type="number" min="0" step="any" required placeholder={t('inv_waste_pieces')} value={production.waste} onChange={e => setProduction({...production,waste:e.target.value})}/>
        <input type="number" min="0" step="any" placeholder={t('inv_wip_completed')} value={production.wip} onChange={e => setProduction({...production,wip:e.target.value})}/>
        <input placeholder={t('inv_notes')} value={production.note} onChange={e => setProduction({...production,note:e.target.value})}/>
        <button disabled={busy}>{t('inv_record_close')}</button>
      </form>}
      {tab === 'WIP' && <div className="inv-table-wrap"><h3>{t('inv_recent_reports')}</h3><table><thead><tr><th>{t('inv_day')}</th><th>{t('inv_part')}</th><th>{t('inv_good')}</th><th>{t('inv_waste')}</th><th>{t('inv_wip_completed')}</th><th>{t('inv_recipe')}</th></tr></thead><tbody>
        {reports.map(r => <tr key={r.id}><td>{r.production_date}</td><td>{items.find(i => i.id===r.item_id)?.part_number}</td><td>{fmt(r.good_quantity)}</td><td>{fmt(r.waste_quantity)}</td><td>{fmt(r.wip_completed)}</td>
          <td>{t(r.bom_id ? 'inv_consumption_recorded' : 'inv_consumption_pending')}</td></tr>)}</tbody></table></div>}
    </section>}

    {tab === 'catalog' && <section className="inv-card"><h2>{t('inv_catalog_title')}</h2>
      <p>{t('inv_catalog_intro')} <Link to="/catalogos">{t('inv_shipping_catalog')}</Link>.</p>
      {canCatalog && <form className="inv-form" onSubmit={e => { e.preventDefault(); act(async () => {
        await unwrap(supabase.from('inventory_items').insert({...itemForm,minimum_quantity:Number(itemForm.minimum_quantity)}));
        setItemForm({...itemForm,part_number:'',description:''});
      },t('inv_material_added')); }}>
        <h3>{t('inv_add_raw_packaging')}</h3><input required placeholder={t('inv_part_number_new')} value={itemForm.part_number} onChange={e => setItemForm({...itemForm,part_number:e.target.value.trim().toUpperCase()})}/>
        <input required placeholder={t('inv_description')} value={itemForm.description} onChange={e => setItemForm({...itemForm,description:e.target.value})}/>
        <select value={itemForm.category} onChange={e => setItemForm({...itemForm,category:e.target.value})}><option value="RAW">{t('inv_raw_short')}</option><option value="PACKAGING">{t('inv_packaging_short')}</option></select>
        <input required placeholder={t('inv_unit')} value={itemForm.uom} onChange={e => setItemForm({...itemForm,uom:e.target.value})}/>
        <input type="number" min="0" step="any" placeholder={t('inv_min_stock')} value={itemForm.minimum_quantity} onChange={e => setItemForm({...itemForm,minimum_quantity:e.target.value})}/>
        <select value={itemForm.responsible_department} onChange={e => setItemForm({...itemForm,responsible_department:e.target.value})}>
          {['inventory','receiving','production','shipping'].map(d => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        <input placeholder={t('inv_location')} value={itemForm.default_location} onChange={e => setItemForm({...itemForm,default_location:e.target.value})}/>
        <button disabled={busy}>{t('inv_add_part')}</button></form>}
      <div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_description')}</th><th>{t('inv_category')}</th><th>{t('inv_unit')}</th><th>{t('inv_minimum')}</th><th>{t('inv_supervisor_responsible')}</th><th>{t('inv_location')}</th><th></th></tr></thead><tbody>
        {items.map(i => <tr key={i.id}><td>{i.part_number}</td><td>{i.description}</td><td>{areaLabel(i.category)}</td><td>{i.uom}</td>
          <td>{editingItem?.id===i.id ? <input type="number" min="0" step="any" value={editingItem.minimum_quantity} onChange={e=>setEditingItem({...editingItem,minimum_quantity:e.target.value})}/> : fmt(i.minimum_quantity)}</td>
          <td>{editingItem?.id===i.id ? <select value={editingItem.responsible_department} onChange={e=>setEditingItem({...editingItem,responsible_department:e.target.value})}>
            {['inventory','receiving','production','shipping','quality'].map(d=><option key={d} value={d}>{departmentLabel(d)}</option>)}</select> : departmentLabel(i.responsible_department)}</td>
          <td>{editingItem?.id===i.id ? <input value={editingItem.default_location || ''} onChange={e=>setEditingItem({...editingItem,default_location:e.target.value})}/> : i.default_location || '—'}</td>
          <td>{canCatalog && (editingItem?.id===i.id ? <button disabled={busy} onClick={()=>act(async()=>{
            await unwrap(supabase.from('inventory_items').update({
              minimum_quantity:Number(editingItem.minimum_quantity),responsible_department:editingItem.responsible_department,
              default_location:editingItem.default_location || null,
            }).eq('id',i.id)); setEditingItem(null);
          },t('inv_limit_saved'))}>{t('inv_save')}</button> :
            <button onClick={()=>setEditingItem(i)}>{t('inv_edit')}</button>)}</td></tr>)}
      </tbody></table></div></section>}

    {tab === 'bom' && <section className="inv-card"><h2>{t('inv_bom_title')}</h2>
      {can('production',true) || canCatalog ? <><form className="inv-form" onSubmit={e => {e.preventDefault();act(async () => {
        const version = 1 + Math.max(0,...boms.filter(b => b.finished_item_id === bomItem).map(b => b.version));
        const row = await unwrap(supabase.from('inventory_boms').insert({finished_item_id:bomItem,version}).select('id').single());
        setBomId(row.id);
      },t('inv_bom_created'));}}>
        <h3>{t('inv_new_version')}</h3><select required value={bomItem} onChange={e => setBomItem(e.target.value)}><option value="">{t('inv_finished_product')}</option>{choose(items,'FG').map(i => <option key={i.id} value={i.id}>{i.part_number}</option>)}</select>
        <button disabled={busy}>{t('inv_create_version')}</button></form>
        <form className="inv-form" onSubmit={e => {e.preventDefault();act(async () => {
          await unwrap(supabase.from('inventory_bom_lines').insert({bom_id:bomId,ingredient_id:bomLine.ingredient,
            quantity_per_unit:Number(bomLine.quantity),waste_rate:Number(bomLine.waste)/100}));
          setBomLine({ingredient:'',quantity:'',waste:'0'});
        },t('inv_ingredient_added'));}}>
          <h3>{t('inv_add_ingredient')}</h3><select required value={bomId} onChange={e => setBomId(e.target.value)}><option value="">{t('inv_select_version')}</option>
            {boms.map(b => <option key={b.id} value={b.id}>{items.find(i=>i.id===b.finished_item_id)?.part_number} · v{b.version}</option>)}</select>
          <select required value={bomLine.ingredient} onChange={e => setBomLine({...bomLine,ingredient:e.target.value})}><option value="">{t('inv_select_raw_packaging')}</option>
            {items.filter(i => i.category !== 'FG').map(i => <option key={i.id} value={i.id}>{i.part_number} ({i.uom})</option>)}</select>
          <input type="number" required min="0.000001" step="any" placeholder={t('inv_qty_per_fg')} value={bomLine.quantity} onChange={e => setBomLine({...bomLine,quantity:e.target.value})}/>
          <input type="number" required min="0" max="99.99" step="any" placeholder={t('inv_standard_waste')} value={bomLine.waste} onChange={e => setBomLine({...bomLine,waste:e.target.value})}/>
          <button disabled={busy}>{t('inv_add_ingredient')}</button></form></> : null}
      {boms.map(b => <div key={b.id} className="inv-bom"><h3>{items.find(i=>i.id===b.finished_item_id)?.part_number} · {t('inv_version')} {b.version} · {t(b.active ? 'inv_active' : 'inv_draft')}</h3>
        <ul>{b.inventory_bom_lines?.map(l => <li key={l.id}>{items.find(i=>i.id===l.ingredient_id)?.part_number}: {t('inv_bom_line', { quantity: fmt(l.quantity_per_unit), waste: fmt(n(l.waste_rate)*100) })}</li>)}</ul>
        {!b.active && (can('production',true) || canCatalog) && <button disabled={busy} onClick={() => act(() => unwrap(supabase.rpc('inventory_publish_bom',{p_bom:b.id})),t('inv_recipe_published'))}>{t('inv_publish_version')}</button>}
      </div>)}</section>}

    {tab === 'demand' && <section className="inv-card"><h2>{t('inv_demand_title')}</h2>
      <p>{t('inv_demand_intro')}</p>
      <p>{t('inv_current_file')}: <strong className="inv-inline-strong">{currentImport?.file_name || t('inv_none')}</strong> {currentImport ? `(${t('inv_rows_backlog', { count: currentImport.expected_rows, date: currentImport.backlog_cutoff || t('inv_no_matrix') })})` : ''}</p>
      {canCatalog && <label className="inv-file">{t('inv_import_raw')} <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => {
        const file = e.target.files?.[0]; if (file) act(() => importDemand(file),t('inv_demand_updated')); e.target.value='';
      }}/></label>}
      <form className="inv-form" onSubmit={e => {e.preventDefault();searchDemand().catch(error=>setMessage(error.message));}}>
        <input placeholder={t('inv_filter_part')} value={demandFilter} onChange={e=>setDemandFilter(e.target.value)}/>
        <select value={demandMode} onChange={e=>setDemandMode(e.target.value)}>
          <option value="all">{t('inv_all')}</option><option value="backlog">{t('inv_backlog')}</option><option value="future">{t('inv_future_demand')}</option></select>
        <button>{t('inv_search')}</button></form>
      <p className="inv-muted">{t('inv_max_500')}</p>
      <div className="inv-table-wrap"><table><thead><tr><th>Ship Date</th><th>{t('inv_po_line')}</th><th>{t('inv_part')}</th><th>{t('inv_destination')}</th><th>{t('inv_quantity')}</th><th>{t('inv_catalog')}</th></tr></thead><tbody>
        {demand.map((r,index) => <tr key={index}><td>{r.ship_date}</td><td>{r.po} / {r.po_line}</td><td>{r.part_number}</td><td>{r.destination}</td><td>{fmt(r.quantity)} {r.uom}</td>
          <td>{t(items.some(i=>i.part_number===r.part_number) ? 'inv_linked' : 'inv_review_part')}</td></tr>)}</tbody></table></div></section>}

    {tab === 'counts' && <section className="inv-card"><h2>{t('inv_counts_title')}</h2>
      <p>{t('inv_counts_intro')}</p>
      <div className="inv-form"><select value={countDepartment} onChange={e=>setCountDepartment(e.target.value)}>
        {['inventory','receiving','production','shipping','quality'].filter(d=>can(d)).map(d=><option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        <select value={countArea} onChange={e=>setCountArea(e.target.value)}>{areas.map(a=><option key={a} value={a}>{areaLabel(a)}</option>)}</select>
        <button onClick={() => saveCsv('plantilla_conteo.csv', countable.map(i=>({ [t('inv_part')]:i.part_number,[t('inv_physical')]:'' })))}>{t('inv_download_template')}</button>
        <label className="inv-file">{t('inv_upload_count')}<input type="file" accept=".csv,.xlsx" onChange={async e=>{
          const file=e.target.files?.[0];if(!file)return;
          try {const rows=await fileRows(file, undefined, t);const next={...physical};
            for(const row of rows){const pn=clean(row['Part Number'] ?? row.part_number ?? row.Parte ?? row.Part ?? row[t('inv_part')]);
              const match=countable.find(i=>i.part_number===pn);
              if(!match)throw Error(t('inv_unknown_part', { part: pn }));
              next[match.id]=clean(row['Physical Quantity'] ?? row.physical_quantity ?? row.Fisico ?? row.Físico ?? row.Physical ?? row[t('inv_physical')]);
            }setPhysical(next);setMessage(t('inv_count_rows_loaded', { count: rows.length }));
          }catch(error){setMessage(error.message);}e.target.value='';
        }}/></label></div>
      <div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_expected')}</th><th>{t('inv_physical')}</th><th>{t('inv_difference')}</th></tr></thead><tbody>
        {countable.map(i=><tr key={i.id}><td>{i.part_number}</td><td>{fmt(qty(i.id,countArea))}</td>
          <td><input type="number" min="0" step="any" value={physical[i.id] ?? ''} onChange={e=>setPhysical({...physical,[i.id]:e.target.value})}/></td>
          <td className={physical[i.id] !== undefined && n(physical[i.id])-qty(i.id,countArea)<0 ? 'inv-negative':''}>
            {physical[i.id] === undefined || physical[i.id] === '' ? '—' : fmt(n(physical[i.id])-qty(i.id,countArea))}</td></tr>)}</tbody></table></div>
      {can(countDepartment) && <button disabled={busy || !countable.some(i=>physical[i.id] !== undefined && physical[i.id] !== '')}
        onClick={() => act(async () => {const rows=countable.filter(i=>physical[i.id] !== undefined && physical[i.id] !== '')
          .map(i=>({item_id:i.id,physical_quantity:Number(physical[i.id])}));
          if(rows.some(r=>!Number.isFinite(r.physical_quantity)||r.physical_quantity<0))throw Error(t('inv_review_quantities'));
          await unwrap(supabase.rpc('inventory_submit_count',{p_department:countDepartment,p_area:countArea,p_lines:rows}));
          setPhysical({});
        },t('inv_count_submitted'))}>{t('inv_submit_count')}</button>}
      <h3>{t('inv_count_reports')}</h3>
      {counts.map(c=><div className="inv-bom" key={c.id}><strong>{areaLabel(c.area)} · {departmentLabel(c.department)} · {statusLabel(c.status)} · {new Date(c.submitted_at).toLocaleString(locale)}</strong>
        <div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_expected')}</th><th>{t('inv_physical')}</th><th>{t('inv_difference')}</th></tr></thead><tbody>
          {c.inventory_count_lines?.map(l=><tr key={l.item_id}><td>{items.find(i=>i.id===l.item_id)?.part_number}</td>
            <td>{fmt(l.expected_quantity)}</td><td>{fmt(l.physical_quantity)}</td>
            <td className={n(l.physical_quantity)-n(l.expected_quantity)<0 ? 'inv-negative':''}>{fmt(n(l.physical_quantity)-n(l.expected_quantity))}</td></tr>)}</tbody></table></div>
        <button onClick={()=>saveCsv(`conteo_${c.id}.csv`,c.inventory_count_lines?.map(l=>({
          [t('inv_part')]:items.find(i=>i.id===l.item_id)?.part_number,[t('inv_expected')]:l.expected_quantity,
          [t('inv_physical')]:l.physical_quantity,[t('inv_difference')]:n(l.physical_quantity)-n(l.expected_quantity),[t('inv_status')]:statusLabel(c.status) }))||[])}>{t('inv_download_report')}</button>
        {c.status==='submitted' && can(c.department,true) && <>
          <button disabled={busy} onClick={()=>act(()=>unwrap(supabase.rpc('inventory_review_count',{p_count:c.id,p_approve:true,p_note:t('inv_mobile_approved_note')})),t('inv_count_approved'))}>{t('inv_approve_apply')}</button>
          <button disabled={busy} className="inv-danger" onClick={()=>act(()=>unwrap(supabase.rpc('inventory_review_count',{p_count:c.id,p_approve:false,p_note:t('inv_mobile_rejected_note')})),t('inv_count_rejected'))}>{t('inv_reject')}</button>
        </>}</div>)}</section>}

    {tab === 'dispatch' && <section className="inv-card"><h2>{t('inv_dispatch_title')}</h2>
      <p>{t('inv_dispatch_intro')}</p>
      {can('shipping',true) && <><div className="inv-form"><select value={selectedIdx} onChange={e=>{setSelectedIdx(e.target.value);setPerBox({});}}>
        <option value="">{t('inv_select_idx')}</option>{pendingIdx.map(idx=><option key={idx}>{idx}</option>)}</select>
        <input type="date" max={today()} value={dispatchDate} onChange={e=>setDispatchDate(e.target.value)}/></div>
        {!!selectedIdx && <><div className="inv-table-wrap"><table><thead><tr><th>{t('inv_part')}</th><th>{t('inv_boxes')}</th><th>{t('inv_pieces_per_box')}</th><th>{t('inv_pieces_deducted')}</th></tr></thead><tbody>
          {selectedLines.map(l=>{const product=l.productos;const a=n(product?.cantidad_por_caja_retornable),b=n(product?.cantidad_por_caja_expendable);
            const initial=a>0&&a===b?a:(!b&&a>0?a:(!a&&b>0?b:''));
            const value=perBox[l.id] ?? initial;
            return <tr key={l.id}><td>{product?.part_number}</td><td>{l.cantidad_cajas}</td>
              <td><input type="number" min="0.000001" step="any" value={value} onChange={e=>setPerBox({...perBox,[l.id]:e.target.value})}/></td>
              <td>{value ? fmt(n(l.cantidad_cajas)*n(value)) : t('inv_enter_box_pieces')}</td></tr>;})}</tbody></table></div>
          <button disabled={busy} onClick={()=>act(async()=>{
            const lineData=selectedLines.map(l=>{const p=l.productos;const a=n(p?.cantidad_por_caja_retornable),b=n(p?.cantidad_por_caja_expendable);
              return {line_id:l.id,pieces_per_box:Number(perBox[l.id] ?? (a>0&&a===b?a:(!b&&a>0?a:(!a&&b>0?b:0))))};});
            if(lineData.some(l=>!l.pieces_per_box||l.pieces_per_box<=0))throw Error(t('inv_confirm_box_pieces'));
            await unwrap(supabase.rpc('inventory_confirm_dispatch',{p_idx:selectedIdx,p_date:dispatchDate,p_lines:lineData,p_note:t('inv_mobile_dispatch_note')}));
            setSelectedIdx('');setPerBox({});
          },t('inv_shipment_confirmed'))}>{t('inv_confirm_idx')}</button></>}</>}
      <h3>{t('inv_confirmed_shipments')}</h3>{dispatches.map(d=><p key={d.idx}>{d.ship_date} · IDX {d.idx} · {t('inv_confirmed_at')} {new Date(d.confirmed_at).toLocaleString(locale)}</p>)}</section>}

    {tab === 'quality' && <section className="inv-card"><h2>{t('inv_quality_title')}</h2>
      <p>{t('inv_quality_intro')}</p>
      <p>{t('inv_quality_pending')}</p></section>}
      </div>
    </div>
  </main>;
}
