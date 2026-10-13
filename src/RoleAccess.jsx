import React,{createContext,useCallback,useContext,useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {supabase} from './supabase/client';
import {subscribeUpdates} from './realtime';
import {roleAllowed} from './roleAccessModel';
import {registerRoleAccess} from './roleAccessTranslations';
import i18n from './i18n/i18n';
registerRoleAccess(i18n);
const Context=createContext(null);
export function RoleAccessProvider({access,children}){
 const [profiles,setProfiles]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;const load=async()=>{const r=await supabase.from('global_role_access_profiles').select('department,role,activities,version');if(!live)return;if(r.error)setError(r.error.message);else{setProfiles(r.data||[]);setError('');}};load();const off=subscribeUpdates(supabase,'role-access',['catalog_updates','global_department_memberships'],load);return()=>{live=false;off();};},[access.userId]);
 const can=useCallback((department,key)=>roleAllowed(profiles||[],access.memberships,access.admin,department,key),[profiles,access.memberships,access.admin]);
 const {t}=useTranslation();
 if(profiles===null)return <div className="global-loading" role={error?'alert':'status'}>{error||t('loading')}</div>;
 return <Context.Provider value={{can,profiles}}>{children}</Context.Provider>;
}
export function useRoleAccess(){return useContext(Context);}
export function SectionPermission({department,activity,children}){const access=useRoleAccess(),{t}=useTranslation();return !access||access.can(department,activity)?children:<p role="alert" className="global-panel">{t('ra_denied')}</p>;}
