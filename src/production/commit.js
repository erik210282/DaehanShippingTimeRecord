import {supabase} from '../supabase/client';
import {notifyUpdates} from '../realtime';
// Invalidate all mounted production views only after a committed write.
export async function productionRpc(name,args){const result=await supabase.rpc(name,args);if(!result.error)notifyUpdates(supabase);return result;}
