import {useEffect,useState} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
import {defaultBreakSettings} from './breaks.mjs';
import {registerLive} from './liveTranslations';
import i18n from '../i18n/i18n';registerLive(i18n);
import {registerDowntime} from './downtimeCodes.mjs';registerDowntime(i18n);
export function useBreakSettings(){
 const [settings,setSettings]=useState(defaultBreakSettings),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{let active=true;const refresh=async()=>{try{const {data,error}=await supabase.from('production_break_settings').select('*').eq('id',true).maybeSingle();if(error)throw error;if(active){setSettings(data||defaultBreakSettings);setError('');}}catch(e){if(active)setError(e.message);}finally{if(active)setReady(true);}};refresh();const off=subscribeUpdates(supabase,'production-breaks',['catalog_updates'],refresh);return()=>{active=false;off();};},[]);
 const save=async values=>{if(['break_minutes','lunch_minutes'].some(k=>!Number.isInteger(Number(values[k]))||Number(values[k])<1||Number(values[k])>240))throw Error('pl_break_invalid');const {data,error}=await supabase.from('production_break_settings').update({break_minutes:Number(values.break_minutes),lunch_minutes:Number(values.lunch_minutes)}).eq('id',true).select().single();if(error)throw error;setSettings(data);return data;};
 return {settings,error,ready,save};
}
