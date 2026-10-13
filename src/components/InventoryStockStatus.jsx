import React,{useState} from 'react';
import {useTranslation} from 'react-i18next';
import {BtnPrimary,BtnSecondary} from './controls';
import {CatalogInput} from './SharedCatalogFields';
import {stockSummary} from '../production/reworkModel';
import {registerRework} from '../production/reworkTranslations';
import i18n from '../i18n/i18n';
registerRework(i18n);
export default function InventoryStockStatus({items,balances}){
 const {t,i18n}=useTranslation(),[input,setInput]=useState(''),[search,setSearch]=useState('');
 const rows=items.filter(i=>['FG','SEMI'].includes(i.category)&&[i.part_number,i.part_name,i.description].join(' ').toLowerCase().includes(search.toLowerCase())),fmt=n=>Number(n||0).toLocaleString(i18n.language,{maximumFractionDigits:3});
 return <section className="inv-card inv-wide"><h2>{t('rw_stock_title')}</h2><form className="catalog-fields" onSubmit={e=>{e.preventDefault();setSearch(input.trim());}}><CatalogInput label={t('rw_search')} value={input} onChange={e=>setInput(e.target.value)}/><div className="live-row-actions"><BtnPrimary type="submit">{t('rw_search')}</BtnPrimary><BtnSecondary type="button" onClick={()=>{setInput('');setSearch('');}}>{t('rw_clear')}</BtnSecondary></div></form><div className="inv-table-wrap"><table><thead><tr>{['inv_part','name','rw_available','rw_quarantine','rw_total'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{rows.map(i=>{const q=stockSummary(i,balances);return <tr key={i.id}><td>{i.part_number}</td><td>{i.part_name||i.description}</td><td>{fmt(q.good)} {i.uom}</td><td style={{color:q.hold>0?'#b91c1c':undefined}}>{fmt(q.hold)} {i.uom}</td><td>{fmt(q.total)} {i.uom}</td></tr>;})}</tbody></table></div></section>;
}
