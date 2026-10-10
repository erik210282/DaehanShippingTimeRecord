import {useEffect,useState} from 'react';
import {supabase} from './supabase/client';
import {subscribeUpdates} from './realtime';
const tables=['actividades_realizadas','tareas_pendientes','shipping_lines','shipping_activity_labels','actividades','productos','operadores','catalogo_pos','catalogo_shipper','bill_charges_to','global_department_memberships'];
// Refresh server reads without remounting the page or resetting filters/forms.
export function useLiveVersion(name){
 const [version,setVersion]=useState(0);
 useEffect(()=>subscribeUpdates(supabase,name,tables,()=>setVersion(value=>value+1)),[name]);
 return version;
}
