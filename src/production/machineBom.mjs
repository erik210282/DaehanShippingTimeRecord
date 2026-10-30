import {workstationProductIds} from './workstationDefaults.mjs';
export const machineLabel=(code,stations=[])=>[code,stations.find(s=>s.code===code)?.name].filter(Boolean).join(' · ');
export function outputIds(station,data){return workstationProductIds(station,data.items||[],['FG','SEMI']);}
export function machineDependencies(data,code,selectedIds){
 const stations=(data.stations||[]).filter(s=>s.active!==false),links=(data.links||[]).filter(l=>l.root_station_code===code),excluded=new Set(links.filter(l=>!l.enabled).map(l=>l.dependency_station_code)),selected=selectedIds||outputIds(stations.find(s=>s.code===code),data);
 const needed=new Set((data.boms||[]).filter(b=>b.active&&!b.archived&&selected.includes(b.finished_item_id)).flatMap(b=>(b.inventory_bom_lines||[]).map(l=>l.ingredient_id)).filter(id=>(data.items||[]).some(i=>i.id===id&&i.active!==false&&['SEMI','FG'].includes(i.category))));
 const nodes=new Map(),issues=[];
 const add=(stationCode,ids,source)=>{if(stationCode===code||excluded.has(stationCode))return;const row=nodes.get(stationCode)||{station_code:stationCode,item_ids:[],source};row.item_ids=[...new Set([...row.item_ids,...ids])];if(source==='manual')row.source=source;nodes.set(stationCode,row);};
 for(const link of links.filter(l=>l.enabled))add(link.dependency_station_code,link.item_ids||[], 'manual');
 for(const id of needed){
  const preferred=links.filter(l=>l.enabled&&(l.item_ids||[]).includes(id));
  const producers=preferred.length?preferred.map(l=>stations.find(s=>s.code===l.dependency_station_code)).filter(Boolean):stations.filter(s=>s.code!==code&&!excluded.has(s.code)&&outputIds(s,data).includes(id));
  if(producers.length===1)add(producers[0].code,[id],preferred.length?'manual':'bom');
  else if(!producers.length)issues.push({type:'missing',item_id:id,parent_station_code:code});
  else issues.push({type:'ambiguous',item_id:id,parent_station_code:code,candidates:producers.map(s=>s.code)});
 }
 return {nodes:[...nodes.values()],issues};
}
export function machineRoutes(data,rootCode,itemIds){
 const routes=[],issues=[],seen=new Map();
 const walk=(code,ids,path,depth)=>{if(path.includes(code)){issues.push({type:'cycle',station_code:code,path:[...path,code]});return;}const key=code+'|'+[...ids].sort().join(',');if(seen.has(key))return;seen.set(key,true);
  const next=machineDependencies(data,code,ids);issues.push(...next.issues);
  for(const row of next.nodes){routes.push({...row,parent_station_code:code,depth});walk(row.station_code,row.item_ids,[...path,code],depth+1);}
 };walk(rootCode,itemIds||outputIds((data.stations||[]).find(s=>s.code===rootCode),data),[],1);return {routes,issues};
}
export function expandMachinePlan(plan,data,newId){
 const removed=new Set(plan.removed_station_codes||[]),manual=plan.stations.filter(r=>!r.auto_added),needed=new Map(),issues=[];
 for(const row of manual.filter(r=>r.station_code)){const result=machineRoutes(data,row.station_code,row.item_ids||[]);issues.push(...result.issues);for(const route of result.routes){if(removed.has(route.station_code))continue;const prior=needed.get(route.station_code)||[];needed.set(route.station_code,[...new Set([...prior,...route.item_ids])]);}}
 const manualCodes=new Set(manual.map(r=>r.station_code)),auto=[];
 for(const [station_code,item_ids] of needed){if(manualCodes.has(station_code))continue;const active=(data.runs||[]).filter(r=>r.station_code===station_code&&!r.closed_at&&!r.deleted_at);if(active.length){issues.push({type:item_ids.every(id=>active.some(r=>r.item_id===id))?'running':'running_missing',station_code});continue;}const old=plan.stations.find(r=>r.auto_added&&r.station_code===station_code);auto.push({...old,key:old?.key||newId(),station_code,item_ids:old?.manual_items?old.item_ids:item_ids,auto_added:true});}
 return {...plan,stations:[...manual,...auto],machine_bom_issues:issues};
}
export function changeMachineStation(plan,key,code,data,newId){
 const old=plan.stations.find(r=>r.key===key),station=data.stations.find(s=>s.code===code);
 if(old?.station_code===code)return plan;
 return expandMachinePlan({...plan,removed_station_codes:(plan.removed_station_codes||[]).filter(s=>s!==code),stations:plan.stations.map(r=>r.key===key?{key:r.key,station_code:code,item_ids:outputIds(station,data),auto_added:false}:r)},data,newId);
}
export function changeMachineProducts(plan,key,ids,data,newId){return expandMachinePlan({...plan,stations:plan.stations.map(r=>r.key===key?{...r,item_ids:ids,manual_items:true}:r)},data,newId);}
export function removeMachine(plan,key,data,newId){const row=plan.stations.find(r=>r.key===key);return expandMachinePlan({...plan,removed_station_codes:[...new Set([...(plan.removed_station_codes||[]),row?.station_code].filter(Boolean))],stations:plan.stations.filter(r=>r.key!==key)},data,newId);}
export function productPlanHours(row,plan){return Object.fromEntries((row.item_ids||[]).map(id=>[id,Number(row.product_hours?.[id]??row.custom_hours??plan.planned_hours??plan.shift_hours)]));}
export function machinePlanHours(row,plan){const values=Object.values(productPlanHours(row,plan));return values.length?Math.max(...values):Number(row.custom_hours??plan.planned_hours??plan.shift_hours);}
export function validPlanHours(value){return value!==''&&Number.isFinite(Number(value))&&Number(value)>=0.5&&Number(value)<=24;}
export function runPlanHours(runs){return Math.max(...runs.map(r=>Number(r.planned_hours||r.shift_hours)),0);}

export function machineRouteGroups(routes){
 const groups=new Map();
 for(const route of routes){let group=groups.get(route.parent_station_code);if(!group){group={station_code:route.parent_station_code,dependencies:[]};groups.set(group.station_code,group);}const previous=group.dependencies.find(r=>r.station_code===route.station_code);if(previous){previous.item_ids=[...new Set([...previous.item_ids,...route.item_ids])];if(route.source==='manual')previous.source='manual';}else group.dependencies.push({...route,item_ids:[...route.item_ids]});}
 return [...groups.values()];
}
export function machineDependencyEdit(data,parent,routes=[]){const codes=[...new Set(routes.map(r=>r.station_code))];return {root_station_code:parent,dependency_station_codes:codes,original_codes:codes,products:Object.fromEntries(routes.map(r=>[r.station_code,r.item_ids])),versions:Object.fromEntries(data.links.filter(l=>l.root_station_code===parent).map(l=>[l.dependency_station_code,l.updated_at]))};}
export function selectMachineDependencies(edit,codes,data){return {...edit,dependency_station_codes:codes,products:Object.fromEntries(codes.map(code=>[code,edit.products[code]??data.links.find(l=>l.root_station_code===edit.root_station_code&&l.dependency_station_code===code)?.item_ids??outputIds(data.stations.find(s=>s.code===code),data)]))};}
export function machineDependencyPayload(edit){return {root_station_code:edit.root_station_code,dependencies:[...new Set([...edit.dependency_station_codes,...edit.original_codes])].map(code=>({dependency_station_code:code,item_ids:edit.products[code]||[],enabled:edit.dependency_station_codes.includes(code),version:edit.versions[code]}))};}
