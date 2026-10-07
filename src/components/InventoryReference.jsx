import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';

export default function InventoryReference({ mode }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); setRows([]); setSearch(''); setPending(false);
    const table = mode === 'stations' ? 'inventory_workstations' : 'inventory_reference_rows';
    let query = supabase.from(table).select('*');
    if (mode === 'stations') query = query.order('code');
    else query = query.eq('batch_key', 'production-files-2026-10-07').eq('kind', mode === 'bom' ? 'bom' : 'inventory').order('source_sheet').order('source_row').limit(1000);
    query.then(({ data, error: failure }) => {
      if (!live) return;
      setError(failure?.message || ''); setRows(data || []); setLoading(false);
    });
    return () => { live = false; };
  }, [mode]);
  const isPending = r => ['unmatched_fg', 'unit_conflict', 'missing_count'].includes(r.status);
  const relevant = useMemo(() => rows.filter(r => mode === 'stations' || (mode === 'bom' ? r.status !== 'excluded' : r.details?.kind === (mode === 'semi' ? 'SEMI' : 'RAW'))), [rows, mode]);
  const visible = relevant.filter(r => (!pending || isPending(r)) && JSON.stringify(r).toLowerCase().includes(search.trim().toLowerCase()));
  const fmt = v => v == null ? t('inv_ref_no_count') : Number(v).toLocaleString(i18n.language, { maximumFractionDigits: 6 });
  return <section className="inv-card">
    <h2>{t(mode === 'stations' ? 'inv_workstations' : 'inv_ref_title')}</h2>
    <p className="inv-muted">{t(mode === 'stations' ? 'inv_station_intro' : 'inv_ref_intro')}</p>
    {mode !== 'stations' && <p>{t('inv_ref_pending', { count: relevant.filter(isPending).length })}</p>}
    <div className="inv-form">
      <input aria-label={t('inv_ref_search')} placeholder={t('inv_ref_search')} value={search} onChange={e => setSearch(e.target.value)} />
      {mode !== 'stations' && <label><input type="checkbox" checked={pending} onChange={e => setPending(e.target.checked)} /> {t('inv_ref_only_pending')}</label>}
    </div>
    {error && <p role="alert" className="inv-message">{error}</p>}
    {loading ? <p role="status">{t('inv_ref_loading')}</p> : <div className="inv-table-wrap"><table>
      <thead><tr>{(mode === 'stations' ? ['inv_station_code', 'inv_station_name', 'inv_station_type', 'inv_station_materials'] : ['inv_part', 'inv_ref_description', 'inv_ref_fg', 'inv_ref_quantity', 'inv_ref_uom', 'inv_ref_source', 'inv_status']).map(k => <th key={k}>{t(k)}</th>)}</tr></thead>
      <tbody>{visible.map(r => mode === 'stations' ? <tr key={r.code}>
        <td>{r.code}</td><td>{r.name}</td><td>{t(`inv_machine_${r.code.split('-')[1]?.slice(0,3)}`, { defaultValue: r.machine_type })}</td>
        <td>{r.materials.map(m => `${m.erp_material} · ${m.product || m.operation}`).join(' / ')}</td>
      </tr> : <tr key={r.id}>
        <td>{r.part_number}</td><td>{r.details.description}</td><td>{r.fg_part_number || r.details.customer || '—'}</td>
        <td>{fmt(r.quantity)}</td><td>{r.uom || '—'}</td><td>{r.source_sheet} · {r.source_row}</td><td>{t(`inv_ref_${r.status}`)}</td>
      </tr>)}</tbody>
    </table>{!visible.length && <p>{t('inv_ref_empty')}</p>}</div>}
  </section>;
}
