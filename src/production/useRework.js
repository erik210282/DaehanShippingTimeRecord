import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
export function useRework(){const [data,setData]=useState({holds:[],reports:[]}),[error,setError]=useState(''),[ready,setReady]=useState(false),live=useRef(false),sequence=useRef(0);
 const refresh=useCallback(async()=>{const n=++sequence.current;const r=await supabase.rpc('production_rework_snapshot');if(r.error)throw r.error;if(live.current&&n===sequence.current){setData({holds:[],reports:[],...r.data});setReady(true);setError('');}},[]);
 useEffect(()=>{live.current=true;const reload=()=>refresh().catch(e=>live.current&&setError(e.message));reload();const off=subscribeUpdates(supabase,'rework',['catalog_updates','inventory_quality_holds','inventory_movements'],reload);return()=>{live.current=false;++sequence.current;off();};},[refresh]);return {data,error,setError,ready,refresh};}
