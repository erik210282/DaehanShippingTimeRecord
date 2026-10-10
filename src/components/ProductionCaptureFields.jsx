import React from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogInput,CatalogSelect} from './SharedCatalogFields';
import {BtnSecondary,BtnDanger,TextAreaStyle} from './controls';
import {formatTimeInput,blankTimedDowntime,maximumCompleteBoxes} from '../production/capture.mjs';
import {downtimeTypes} from '../production/model.mjs';

export function ProductionClockInput({label,value,onChange,required=true}) {
 const {t}=useTranslation();
 return <CatalogInput label={label} required={required} inputMode="numeric" maxLength={5} pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" placeholder={t('pr_enter_time')} value={String(value||'').slice(0,5)} onChange={event=>onChange(formatTimeInput(event.target.value))}/>;
}
export function ProductionStaffNames({report,onChange}) {
 const {t}=useTranslation();
 return Number(report.people)>0||report.staff_names?<label className="catalog-field production-staff"><span>{t('pr_staff_names_optional')}</span><TextAreaStyle aria-label={t('pr_staff_names_optional')} rows={3} maxLength={2000} value={report.staff_names||''} onChange={event=>onChange({...report,staff_names:event.target.value})}/></label>:null;
}
export function ProductionDowntimes({report,captured,onChange}) {
 const {t}=useTranslation(),events=report.downtime_events||[];
 return <section className="production-section"><div className="production-section-heading"><h3>{t('pr_downtime_section')}</h3><BtnSecondary type="button" onClick={()=>onChange({...report,downtime_events:[...events,blankTimedDowntime()]})}>{t('pr_downtime_add')}</BtnSecondary></div><p className="inv-muted">{t('pr_downtime_hint')}</p>
 {!events.length&&<p className="production-empty">{t('pr_downtime_empty')}</p>}
 {events.map((d,index)=>{const change=patch=>onChange({...report,downtime_events:events.map((row,k)=>k===index?{...row,...patch}:row)}),timed=Object.hasOwn(d,'start_time')||Object.hasOwn(d,'end_time');
 return <div className="production-downtime-row production-downtime-timed" key={index}>
 <CatalogSelect label={t('pr_downtime_type')} value={d.type} onChange={type=>change({type})} options={downtimeTypes.map(value=>({value,label:t('pr_downtime_'+value)}))}/>
 {timed?<><ProductionClockInput label={t('pr_downtime_start')} value={d.start_time} onChange={start_time=>change({start_time})}/><ProductionClockInput label={t('pr_downtime_end')} value={d.end_time} onChange={end_time=>change({end_time})}/><CatalogInput label={t('pr_downtime_duration')} readOnly value={captured.downtime_events[index]?.minutes||''}/></>:<CatalogInput label={t('pr_downtime_duration')} required type="number" min="0.001" step="any" value={d.minutes} onChange={event=>change({minutes:event.target.value})}/>}
 <CatalogInput label={t('pr_downtime_note')} value={d.note||''} onChange={event=>change({note:event.target.value})}/>
 <BtnDanger type="button" onClick={()=>onChange({...report,downtime_events:events.filter((_,k)=>k!==index)})}>{t('delete')}</BtnDanger>
 </div>;})}
 </section>;
}
export function ProductionCompleteBoxes({report,profile,good,onChange}) {
 const {t}=useTranslation(),max=maximumCompleteBoxes(good,profile?.pieces_per_box);
 return <CatalogInput label={t('pr_boxes')} required inputMode="numeric" type="number" min={0} max={max} step="1" value={report.full_boxes??''} onChange={event=>onChange({...report,full_boxes:event.target.value})}/>;
}
