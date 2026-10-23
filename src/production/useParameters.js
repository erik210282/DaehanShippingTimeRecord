
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
export function useParameters(filters){
 const [data,setData]=useState({templates:[],reports:[],total:0}),[ready,setReady]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),sequence=useRef(0);
 const {from,to,station,search,outside}=filters;
 const refresh=useCallback(async()=>{const n=++sequence.current;const {data:value,error:failure}=await supabase.rpc('production_parameter_snapshot',{p_from:from,p_to:to,p_station:station,p_search:search,p_outside:outside});if(failure)throw failure;if(mounted.current&&n===sequence.current){setData({templates:[],reports:[],total:0,...value});setReady(true);setError('');}},[from,to,station,search,outside]);
 useEffect(()=>{mounted.current=true;setReady(false);const update=()=>refresh().catch(e=>mounted.current&&setError(e.message));update();const off=subscribeUpdates(supabase,'production-parameters',['catalog_updates','machine_types'],update);return()=>{mounted.current=false;++sequence.current;off();};},[refresh]);
 return {data,ready,error,setError,refresh};
}

