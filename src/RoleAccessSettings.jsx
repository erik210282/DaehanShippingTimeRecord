import {uiTitle} from './components/actionTheme.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CatalogSelect} from './components/SharedCatalogFields';
import {BtnPrimary} from './components/controls';
import ErrorPopup from './components/ErrorPopup';
import {supabase} from './supabase/client';
import {activityCatalog,activityLabel,roleKeys} from './roleAccessModel';
import {useRoleAccess} from './RoleAccess';
export default function RoleAccessSettings({access,managed}){
 const {t,i18n}=useTranslation(),context=useRoleAccess(),[rows,setRows]=useState(context?.profiles||[]),[department,setDepartment]=useState(managed[0]||''),[role,setRole]=useState('operador'),[draft,setDraft]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),lock=useRef(false);
 const profile=rows.find(p=>p.department===department&&p.role===role);
 useEffect(()=>{let live=true;supabase.from('global_role_access_profiles').select('department,role,activities,version').then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setRows(r.data||[]);});return()=>{live=false;};},[]);
 useEffect(()=>{setDraft(profile?.activities||[]);},[department,role,profile?.version]);
 useEffect(()=>setSaved(false),[department,role]);
 const editable=access.admin||role!=='supervisor';
 async function save(){if(lock.current||!profile)return;lock.current=true;setBusy(true);setError('');setSaved(false);try{const r=await supabase.rpc('save_role_access',{p_department:department,p_role:role,p_activities:draft,p_version:profile.version});if(r.error)throw r.error;setRows(v=>v.map(p=>p===profile?{...p,activities:draft,version:p.version+1}:p));setSaved(true);window.dispatchEvent(new Event('global-access-updated'));}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
 return <section className="global-panel"><h2>{uiTitle(t('ra_roles'))}</h2><p>{t('ra_hint')}</p><div className="catalog-fields"><CatalogSelect label={uiTitle(t('ra_department'))} value={department} onChange={setDepartment} options={managed.map(value=>({value,label:t('global_'+value)}))}/><CatalogSelect label={uiTitle(t('ra_role'))} value={role} onChange={setRole} options={roleKeys.map(value=>({value,label:t('global_role_'+value)}))}/></div>
 {!editable&&<p>{t('ra_limited')}</p>}<div className="global-department-choices">{activityCatalog.filter(c=>c.department===department).map(row=><label className="role-activity-choice" key={row.activity}><input type="checkbox" checked={draft.includes(row.activity)} disabled={busy||!profile||!editable||!row.allowed_roles.includes(role)} onChange={e=>{setSaved(false);setDraft(v=>e.target.checked?[...v,row.activity]:v.filter(k=>k!==row.activity));}}/><span>{activityLabel(row,i18n.language)}</span>{!row.allowed_roles.includes(role)&&<small>{t('ra_limited')}</small>}</label>)}</div>
 <BtnPrimary intent="confirm" disabled={busy||!profile||!editable} onClick={save}>{t('save')}</BtnPrimary>{saved&&<p role="status">{t('ra_saved')}</p>}<ErrorPopup message={error?t(error,{defaultValue:t('global_retry')}):''} onClose={()=>setError('')}/></section>;
}
