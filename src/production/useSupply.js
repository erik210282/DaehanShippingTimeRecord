import {useCallback,useEffect,useRef,useState,useMemo} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
import {supplyRows} from './supply.mjs';
export function useSupply(){
 const [data,setData]=useState({schedules:[],materials:[],runs:[],loads:[],wip:[],baselines:[]}),[error,setError]=useState(''),[ready,setReady]=useState(false),[now,setNow]=useState(new Date());
 const live=useRef(false),sequence=useRef(0);
 const refresh=useCallback(async()=>{const n=++sequence.current;const {data:value,error:failure}=await supabase.rpc('production_supply_snapshot');if(failure)throw failure;if(live.current&&n===sequence.current){setData({schedules:[],materials:[],runs:[],loads:[],wip:[],baselines:[],...value});setNow(new Date());setReady(true);setError('');}},[]);
 useEffect(()=>{live.current=true;const update=()=>refresh().catch(e=>live.current&&setError(e.message));update();const off=subscribeUpdates(supabase,'production-supply',['catalog_updates'],update);const timer=setInterval(()=>setNow(new Date()),15000);return()=>{live.current=false;++sequence.current;clearInterval(timer);off();};},[refresh]);
 const rows=useMemo(()=>supplyRows(data,now),[data,now]);
 return {data,rows,error,setError,ready,refresh};
}
export function useSupplyAlerts(rows,enabled){
 const acknowledged=useRef(new Set()),[alerts,setAlerts]=useState([]);
 useEffect(()=>{if(!enabled){setAlerts([]);return;}const low=rows.filter(r=>r.low),keys=new Set(low.map(r=>r.station_code+':'+r.item_id));for(const key of acknowledged.current)if(!keys.has(key))acknowledged.current.delete(key);setAlerts(low.filter(r=>!acknowledged.current.has(r.station_code+':'+r.item_id)));},[rows,enabled]);
 const dismiss=()=>{for(const r of alerts)acknowledged.current.add(r.station_code+':'+r.item_id);setAlerts([]);};
 return {alerts,dismiss};
}
