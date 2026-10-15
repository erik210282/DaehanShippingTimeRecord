import React,{useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogInput} from '../components/SharedCatalogFields';
import {BtnPrimary} from '../components/controls';
import ErrorPopup from '../components/ErrorPopup';
import {useBreakSettings} from './useBreakSettings';
export default function ProductionBreakSettings(){const {t}=useTranslation(),{settings,ready,error,save}=useBreakSettings(),[values,setValues]=useState(settings),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[saved,setSaved]=useState(false);useEffect(()=>setValues(settings),[settings]);
 return <section className="card live-monitor"><h2>{t('pl_break_settings')}</h2><p>{t('pl_break_hint')}</p><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await save(values);setSaved(true);}catch(e){setFailure(e.message);}finally{setBusy(false);}}}><div className="live-form-grid">{['break_minutes','lunch_minutes'].map(key=><CatalogInput key={key} required type="number" min="1" max="240" step="1" label={t('pl_'+key)} value={values[key]} onChange={e=>{setValues({...values,[key]:e.target.value});setSaved(false);}}/>)}</div><div className="live-row-actions" style={{marginTop:24}}><BtnPrimary disabled={busy||!ready}>{t('save')}</BtnPrimary>{saved&&<span role="status">{t('pl_break_saved')}</span>}</div></form><ErrorPopup message={failure||error} onClose={()=>setFailure('')}/></section>;
}
