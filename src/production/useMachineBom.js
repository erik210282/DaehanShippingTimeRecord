import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates,notifyUpdates} from '../realtime';
export function useMachineBom(enabled=true){
 const [data,setData]=useState({items:[],stations:[],boms:[],links:[],can_manage:false}),[ready,setReady]=useState(!enabled),[error,setError]=useState('');const alive=useRef(false),version=useRef(0);
 const refresh=useCallback(async()=>{const n=++version.current;const {data:value,error}=await supabase.rpc('production_machine_bom_snapshot');if(error)throw error;if(alive.current&&n===version.current){setData(value);setReady(true);setError('');}},[]);
 useEffect(()=>{if(!enabled){setReady(true);return;}alive.current=true;const update=()=>refresh().catch(e=>alive.current&&setError(e.message));update();const off=subscribeUpdates(supabase,'production-machine-bom',['catalog_updates'],update);return()=>{alive.current=false;++version.current;off();};},[enabled,refresh]);
 async function save(action,payload){const {error}=await supabase.rpc('production_machine_bom_action',{p_action:action,p_data:payload});if(error)throw error;notifyUpdates(supabase);await refresh();}
 return {data,ready,error,setError,refresh,save};
}
