import './NativeShipping.css';
import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {supabase} from './supabase/client';
import {nativeShipping, postShippingMessage} from './nativeShippingBridge';

export default function NativeShippingGate({children}) {
  const {t,i18n}=useTranslation(),[ready,setReady]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if (!nativeShipping) return;
    let active=true, serial=Promise.resolve(), lastToken='';
    document.body.classList.add('native-shipping');
    supabase.auth.stopAutoRefresh();
    const receive=event=>{
      const data=event.detail;
      if(data?.type==='shipping:language' && ['en','es','ko'].includes(data.language)) i18n.changeLanguage(data.language);
      if(data?.type!=='shipping:session' || typeof data.access_token!=='string' || typeof data.refresh_token!=='string') return;
      if(data.access_token===lastToken) return;
      lastToken=data.access_token;
      // Serialize refreshes to prevent an older session from replacing a newer one.
      serial=serial.then(async()=>{
        try {
          const result=await supabase.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
          supabase.auth.stopAutoRefresh();
          if(!active)return;
          if(result.error || !result.data.session) throw result.error || new Error('Session unavailable');
          if(['en','es','ko'].includes(data.language)) await i18n.changeLanguage(data.language);
          setError('');setReady(true);
          postShippingMessage({type:'shipping:authenticated'});
        } catch {
          lastToken='';if(active){setError(t('ra_denied'));setReady(false);}
          postShippingMessage({type:'shipping:auth-error'});
        }
      });
    };
    window.addEventListener('daehan-native',receive);
    postShippingMessage({type:'shipping:ready'});
    return()=>{active=false;window.removeEventListener('daehan-native',receive);document.body.classList.remove('native-shipping');};
  },[]);
  if(!nativeShipping)return children;
  if(!ready)return <div role={error?'alert':'status'} style={{padding:24}}>{error||t('loading')}</div>;
  return children;
}
