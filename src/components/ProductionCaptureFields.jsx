import {reportWithAutomaticBreaks,registerAutomaticBreaks} from '../production/automaticBreaks.mjs';
import i18n from '../i18n/i18n';
registerAutomaticBreaks(i18n);
import {plannedType,plannedChange,downtimeTypeLabel} from '../production/breaks.mjs';
import {useBreakSettings} from '../production/useBreakSettings';
import React from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogInput,CatalogSelect} from './SharedCatalogFields';
import {BtnSecondary,BtnDanger,TextAreaStyle} from './controls';
import {downtimeDuration,formatTimeInput,blankTimedDowntime,maximumCompleteBoxes} from '../production/capture.mjs';
import {downtimeTypes} from '../production/model.mjs';
import {useDowntimeCodes} from '../production/useDowntimeCodes';
import {codeKey,codeOptions,selectCode} from '../production/downtimeCodes.mjs';

export function ProductionClockInput({label,value,onChange,required=true,disabled=false,readOnly=false}) {
 const {t}=useTranslation();
 return <CatalogInput disabled={disabled} readOnly={readOnly} label={label} required={required} inputMode="numeric" maxLength={5} pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" placeholder={t('pr_enter_time')} value={String(value||'').slice(0,5)} onChange={event=>onChange(formatTimeInput(event.target.value))}/>;
}
export function ProductionStaffNames({report,onChange}) {
 const {t}=useTranslation();
 return Number(report.people)>0||report.staff_names?<label className="catalog-field production-staff"><span>{t('pr_staff_names_optional')}</span><TextAreaStyle aria-label={t('pr_staff_names_optional')} rows={3} maxLength={2000} value={report.staff_names||''} onChange={event=>onChange({...report,staff_names:event.target.value})}/></label>:null;
}
export function ProductionDowntimes({report,captured,onChange,disabled=false}) {
 const {t}=useTranslation(),{settings}=useBreakSettings(),{codes}=useDowntimeCodes(),events=reportWithAutomaticBreaks(report).downtime_events||[];
 return <section className="production-section"><div className="production-section-heading"><h3>{t('pr_downtime_section')}</h3><BtnSecondary type="button" disabled={disabled} onClick={()=>onChange({...report,downtime_events:[...events,blankTimedDowntime()]})}>{t('pr_downtime_add')}</BtnSecondary></div><p className="inv-muted">{t('pr_downtime_hint')} {t('ab_hint')}</p>
 {!events.length&&<p className="production-empty">{t('pr_downtime_empty')}</p>}
 {events.map((d,index)=>{if(d.automatic)return <div className="production-downtime-row" key={d.schedule_key}><strong>{t(d.type==='inactive'?'pl_inactive':d.type==='lunch'?'pr_downtime_lunch':'pr_downtime_break')}</strong><span>{d.start_time} — {d.end_time} · {d.minutes} min</span><small>{t(d.type==='inactive'?'pl_inactive_hint':'ab_fixed')}</small></div>;const change=patch=>onChange({...report,downtime_events:events.map((row,k)=>k===index?plannedChange(row,patch,settings):row)}),timed=Object.hasOwn(d,'start_time')||Object.hasOwn(d,'end_time');
 return <div className="production-downtime-row production-downtime-timed" key={index}>
 <CatalogSelect label={t('dt_code')} value={codeKey(d)} onChange={id=>{const next=selectCode(d,id,codes);change({...next,...(plannedType(next.type)?{type:next.type}: {})});}} options={codeOptions(codes,d,t,settings)}/>
 {timed?<><ProductionClockInput label={t('pr_downtime_start')} value={d.start_time} onChange={start_time=>change({start_time})}/>{!plannedType(d.type)&&<><ProductionClockInput label={t('pr_downtime_end')} value={d.end_time} onChange={end_time=>change({end_time})}/><CatalogInput label={t('pr_downtime_duration')} readOnly value={downtimeDuration(d)}/></>}</>:<CatalogInput label={t('pr_downtime_duration')} readOnly={plannedType(d.type)} required type="number" min="0.001" step="any" value={d.minutes} onChange={event=>change({minutes:event.target.value})}/>}
 <CatalogInput label={t('pr_downtime_note')} value={d.note||''} onChange={event=>change({note:event.target.value})}/>
 <BtnDanger type="button" onClick={()=>onChange({...report,downtime_events:events.filter((_,k)=>k!==index)})}>{t('delete')}</BtnDanger>
 </div>;})}
 </section>;
}
export function ProductionCompleteBoxes({report,profile,good,onChange}) {
 const {t}=useTranslation(),max=maximumCompleteBoxes(good,profile?.pieces_per_box);
 return <CatalogInput label={t('pr_boxes')} required inputMode="numeric" type="number" min={0} max={max} step="1" value={report.full_boxes??''} onChange={event=>onChange({...report,full_boxes:event.target.value})}/>;
}
