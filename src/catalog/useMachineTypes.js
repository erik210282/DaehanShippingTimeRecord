import {allRows} from '../dataExport.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../supabase/client';
import {subscribeUpdates} from '../realtime';
export function useMachineTypes(){
 const [types,setTypes]=useState([]),[error,setError]=useState(''),alive=useRef(false),sequence=useRef(0);
 const refresh=useCallback(async()=>{const request=++sequence.current;let data,error;try{data=await allRows(()=>supabase.from('machine_types').select('*').order('name').order('id'));}catch(failure){error=failure;}if(alive.current&&request===sequence.current){setTypes(error?[]:data||[]);setError(error?.message||'');}},[]);
 useEffect(()=>{alive.current=true;refresh();const off=subscribeUpdates(supabase,'machine-types',['machine_types','catalog_updates'],refresh);return()=>{alive.current=false;++sequence.current;off();};},[refresh]);
 return {types,error,refresh};
}
export function machineTypeOptions(types,selected=[]){return types.filter(row=>row.active||selected.includes(row.name)).map(row=>({value:row.name,label:row.name}));}
