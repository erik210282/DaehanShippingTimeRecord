export const phases=['stage','label','scan','load'];
export const activeStates=['iniciada','pausada'];
export const activityName=(row,catalog)=>String(catalog.find(a=>a.id===row.actividad)?.nombre||row.actividad||'').trim().toLowerCase();
export const needsLabel=(row,products)=>row.productos?.some(p=>!['delivery','empty','empty crates'].includes(String(products.find(c=>c.id===p.producto)?.nombre||p.producto||'').trim().toLowerCase()));
export const dock=value=>{const digits=String(value||'').replace(/\D/g,'');return digits?`DOCK ${digits}`:'';};
export const trailer=value=>String(value||'').trim().toUpperCase();
export function validateLoad(row,draft,products,catalog,capture,planned=false){
 if(activityName(row,catalog)!=='load')return;
 if(!trailer(draft.trailer)||!dock(draft.dock))throw Error('so_load_required');
 if(needsLabel(row,products)&&!(planned||capture?/^(?:\d{4,5}|(?:6J|5J|1J)\S{4,})$/i:/^\d{4}$/).test(draft.label||''))throw Error('so_label_required');
 if(capture||row.hora_inicio){const saved=capture||row;if(saved.trailer&&trailer(saved.trailer)!==trailer(draft.trailer)||saved.puerta&&dock(saved.puerta)!==dock(draft.dock))throw Error('so_mismatch');if(!capture&&needsLabel(row,products)&&row.etiqueta_inicio_manual===draft.label)throw Error('so_other_label');}
}
export function canFinish(row,active,catalog){const position=phases.indexOf(activityName(row,catalog));return !active.some(a=>a.id!==row.id&&a.idx===row.idx&&activeStates.includes(a.estado)&&phases.indexOf(activityName(a,catalog))>=0&&phases.indexOf(activityName(a,catalog))<position);}
export function pausedMinutes(events,end){let start=null,total=0;for(const event of [...events].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))){if(event.tipo==='pausa'&&start===null)start=new Date(event.timestamp);if(event.tipo==='reanudar'&&start!==null){total+=Math.max(0,new Date(event.timestamp)-start);start=null;}}if(start!==null)total+=Math.max(0,new Date(end)-start);return total/60000;}
async function value(request){const {data,error}=await request;if(error)throw error;return data;}
export function operatorApi(db){
 async function identity(){const {data,error}=await db.auth.getUser();if(error)throw error;if(!data.user)throw Error('so_identity');const person=await value(db.from('operadores').select('id,nombre,activo').eq('uid',data.user.id).maybeSingle());if(!person?.activo)throw Error('so_identity');return person;}
 async function load(){const [tasks,active,products,catalog,operators,person]=await Promise.all([
  value(db.from('tareas_pendientes').select('*').in('estado',['pendiente',...activeStates]).order('prioridad').order('createdAt')),
  value(db.from('actividades_realizadas').select('*').in('estado',activeStates).order('hora_inicio')),
  value(db.from('productos').select('id,nombre,part_number')),
  value(db.from('actividades').select('id,nombre,activo')),
  value(db.from('operadores').select('id,nombre,activo').eq('activo',true).order('nombre')),identity()]);
 const idxs=[...new Set(tasks.map(t=>t.idx).filter(Boolean))],ids=active.map(a=>a.id);
 const [lines,captures]=await Promise.all([idxs.length?value(db.from('shipping_lines').select('id,idx').in('idx',idxs)):[],ids.length?value(db.from('shipping_activity_labels').select('actividad_id,trailer,puerta,etiqueta_inicio').in('actividad_id',ids)):[]]);
 return {tasks,active,products,catalog,operators,person,lines,captures};}
 async function begin(task,draft,data){const person=await identity();validateLoad(task,draft,data.products,data.catalog,null,data.lines.some(l=>l.idx===task.idx));
 if(!task.productos?.length||task.productos.some(p=>!p.producto||!(Number(p.cantidad)>0)))throw Error('so_products_required');
 const operators=[...new Set([person.id,...(draft.operators||[]).filter(id=>data.operators.some(o=>o.id===id))])];
 const existing=await value(db.from('actividades_realizadas').select('id,operadores').eq('tarea_id',task.id).in('estado',[...activeStates,'finalizada']).limit(1));
 if(existing.length){await value(db.from('tareas_pendientes').update({estado:'iniciada',operadores:existing[0].operadores}).eq('id',task.id).eq('estado','pendiente'));return existing[0].id;}
 const isLoad=activityName(task,data.catalog)==='load';
 if(isLoad&&needsLabel(task,data.products)&&data.lines.some(l=>l.idx===task.idx))return value(db.rpc('shipping_begin_activity',{p_tarea:task.id,p_etiqueta:draft.label,p_operadores:operators,p_trailer:trailer(draft.trailer),p_puerta:dock(draft.dock)}));
 const rows=await value(db.from('actividades_realizadas').insert({idx:task.idx||'',actividad:task.actividad,productos:task.productos,operadores:operators,hora_inicio:new Date().toISOString(),estado:'iniciada',tarea_id:task.id,notas:'',instrucciones_supervisor:task.instrucciones_supervisor||task.notas||'',...(isLoad?{trailer:trailer(draft.trailer),puerta:dock(draft.dock),etiqueta_inicio_manual:needsLabel(task,data.products)?draft.label:null}:{})}).select('id'));
 await value(db.from('tareas_pendientes').update({estado:'iniciada',operadores:operators}).eq('id',task.id).eq('estado','pendiente'));return rows[0].id;}
 async function pause(row,notes){await identity();const fresh=await value(db.from('actividades_realizadas').select('*').eq('id',row.id).maybeSingle());if(!fresh||!activeStates.includes(fresh.estado))throw Error('so_changed');const state=fresh.estado==='pausada'?'iniciada':'pausada',now=new Date().toISOString();const changed=await value(db.from('actividades_realizadas').update({estado:state,notas:notes??fresh.notas,updatedAt:now}).eq('id',row.id).eq('estado',fresh.estado).select('id'));if(!changed.length)throw Error('so_changed');await value(db.from('pausas_historial').insert({actividad_id:row.id,tipo:state==='pausada'?'pausa':'reanudar',timestamp:now}));if(row.tarea_id)await value(db.from('tareas_pendientes').update({estado:state}).eq('id',row.tarea_id));}
 async function next(row,data){const name=phases[phases.indexOf(activityName(row,data.catalog))+1];if(!phases.includes(activityName(row,data.catalog))||!name)return;const activity=data.catalog.find(a=>String(a.nombre).toLowerCase()===name&&a.activo!==false);if(!activity)throw Error('so_next_missing');const [tasks,records]=await Promise.all([value(db.from('tareas_pendientes').select('id').eq('idx',row.idx).eq('actividad',activity.id).in('estado',['pendiente',...activeStates,'finalizada']).limit(1)),value(db.from('actividades_realizadas').select('id').eq('idx',row.idx).eq('actividad',activity.id).in('estado',[...activeStates,'finalizada']).limit(1))]);if(tasks.length||records.length)return;await value(db.from('tareas_pendientes').insert({idx:row.idx,tarea_id:row.tarea_id,actividad:activity.id,productos:row.productos,notas:'',estado:'pendiente',es_urgente:row.es_urgente||false,mismo_dia:row.mismo_dia||false,createdAt:new Date().toISOString()}));}
 async function finish(row,draft,data){await identity();const active=await value(db.from('actividades_realizadas').select('*').in('estado',activeStates).eq('idx',row.idx));if(!canFinish(row,active,data.catalog))throw Error('so_previous');const fresh=await value(db.from('actividades_realizadas').select('*').eq('id',row.id).maybeSingle());if(fresh?.estado==='finalizada'){if(row.tarea_id)await value(db.from('tareas_pendientes').update({estado:'finalizada'}).eq('id',row.tarea_id));await next(row,data);return;}if(fresh?.estado!=='iniciada')throw Error('so_resume_first');
 const capture=await value(db.from('shipping_activity_labels').select('*').eq('actividad_id',row.id).maybeSingle());validateLoad(fresh,draft,data.products,data.catalog,capture);
 if(capture){await value(db.rpc('shipping_end_activity',{p_actividad:row.id,p_etiqueta:draft.label,p_comentario:draft.notes??row.comentario_actividad??row.notas??'',p_trailer:trailer(draft.trailer),p_puerta:dock(draft.dock)}));return;}
 const products=(row.productos||[]).map((p,i)=>({...p,cantidad:draft.quantities?.[i]===undefined?p.cantidad:Number(String(draft.quantities[i]).replaceAll(',',''))}));if(products.some(p=>!Number.isFinite(Number(p.cantidad))||Number(p.cantidad)<=0))throw Error('so_products_required');
 const now=new Date().toISOString(),events=await value(db.from('pausas_historial').select('tipo,timestamp').eq('actividad_id',row.id).order('timestamp')),elapsed=Math.max(0,(new Date(now)-new Date(row.hora_inicio))/60000),paused=Math.min(elapsed,pausedMinutes(events,now)),isLoad=activityName(row,data.catalog)==='load';
 await value(db.from('actividades_realizadas').update({estado:'finalizada',hora_fin:now,duracion:elapsed-paused,pausa_total:paused,productos:products,notas:draft.notes??row.notas??'',updatedAt:now,...(isLoad?{trailer_fin:trailer(draft.trailer),puerta_fin:dock(draft.dock),etiqueta_fin_manual:needsLabel(row,data.products)?draft.label:null}:{})}).eq('id',row.id).eq('estado','iniciada').select('id'));
 if(row.tarea_id)await value(db.from('tareas_pendientes').update({estado:'finalizada'}).eq('id',row.tarea_id));await next({...row,productos:products},data);}
 return {load,begin,pause,finish,next};
}
