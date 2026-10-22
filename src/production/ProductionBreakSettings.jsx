import {uiTitle} from '../components/actionTheme.mjs';
import React,{useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogInput} from '../components/SharedCatalogFields';
import {BtnPrimary} from '../components/controls';
import ErrorPopup from '../components/ErrorPopup';
import {useBreakSettings} from './useBreakSettings';
import DowntimeCodeSettings from './DowntimeCodeSettings';
export default function ProductionBreakSettings({embedded=false}){const {t}=useTranslation(),{settings,ready,error,save}=useBreakSettings(),[values,setValues]=useState(settings),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[saved,setSaved]=useState(false);useEffect(()=>setValues(settings),[settings]);
 return <section className={embedded?'production-settings-panel':'card live-monitor'}><header className="live-page-header"><div><h2>{uiTitle(t('pl_break_settings'))}</h2><p className="inv-muted">{t('pl_break_hint')}</p></div></header><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await save(values);setSaved(true);}catch(e){setFailure(e.message);}finally{setBusy(false);}}}><div className="live-form-grid">{['break_minutes','lunch_minutes'].map(key=><CatalogInput key={key} required type="number" min="1" max="240" step="1" label={uiTitle(t('pl_'+key))} value={values[key]} onChange={e=>{setValues({...values,[key]:e.target.value});setSaved(false);}}/>)}</div><div className="live-row-actions" style={{marginTop:24}}><BtnPrimary intent="confirm" disabled={busy||!ready}>{t('save')}</BtnPrimary>{saved&&<span role="status">{t('pl_break_saved')}</span>}</div></form><DowntimeCodeSettings/><ErrorPopup message={failure||error} onClose={()=>setFailure('')}/></section>;
}
