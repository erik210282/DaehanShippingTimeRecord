import {uiTitle} from '../components/actionTheme.mjs';
import React,{useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogInput,CatalogSelect} from '../components/SharedCatalogFields';
import {BtnPrimary,BtnSecondary} from '../components/controls';
import {printPeople} from './parameterPrint.mjs';
import {createParameterPdf} from './parameterPdf';

export default function ParameterPrintDialog({report,staff,onClose,onError}){
 const {t}=useTranslation(),options=useMemo(()=>printPeople(report,staff),[report,staff]),[people,setPeople]=useState(()=>printPeople(report,staff)),[busy,setBusy]=useState(false);
 async function generate(e){e.preventDefault();if(busy)return;if(!people.facilitator||!people.supervisor){onError('pp_print_people_required');return;}setBusy(true);try{await createParameterPdf(report,people);onClose();}catch(error){onError(error.message?.startsWith('pp_')?error.message:'pp_print_error');}finally{setBusy(false);}}
 return <form onSubmit={generate}><header className="live-dialog-header"><h2>{uiTitle(t('pp_print_pdf'))}</h2><p>{report.station_code} · {report.station_name} · {report.recorded_date} · {String(report.recorded_time).slice(0,5)}</p></header><fieldset className="live-dialog-body" disabled={busy}><p className="inv-muted">{t('pp_print_hint')}</p><div className="live-form-grid">{options.isLeader?<CatalogInput label={uiTitle(t('pp_print_facilitator'))} readOnly value={people.facilitator}/>:<CatalogSelect label={uiTitle(t('pp_print_facilitator'))} value={people.facilitator} options={options.facilitators} onChange={facilitator=>setPeople(p=>({...p,facilitator}))}/>}<CatalogSelect label={uiTitle(t('pp_print_supervisor'))} value={people.supervisor} options={options.supervisors} onChange={supervisor=>setPeople(p=>({...p,supervisor}))}/><CatalogSelect label={uiTitle(t('pp_print_shift'))} value={people.shift} options={['DAY SHIFT','NIGHT SHIFT'].map(value=>({value,label:value}))} onChange={shift=>setPeople(p=>({...p,shift}))}/><CatalogInput label={uiTitle(t('pr_date'))} value={report.recorded_date} readOnly/></div><p className="inv-muted">{t('pp_print_shift_hint')}</p></fieldset><footer className="live-dialog-footer"><BtnPrimary intent="confirm" disabled={busy||!people.supervisor||!people.facilitator||!people.shift} type="submit">{t(busy?'pp_print_generating':'pp_print_pdf')}</BtnPrimary><BtnSecondary intent="danger" disabled={busy} type="button" onClick={onClose}>{t('cancel')}</BtnSecondary></footer></form>;
}
