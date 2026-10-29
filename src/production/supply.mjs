
export function partLabel(item){return [item?.part_number,item?.productos?.nombre||item?.part_name||item?.description].filter(Boolean).join(' · ').toUpperCase();}
export function contributorNames(run,checkpoints=[],people=[]){
 const participants=run.contributors??checkpoints.filter(c=>c.run_id===run.id&&!c.deleted_at).map(c=>({uid:c.created_by}));
 const ids=new Set();return participants.filter(p=>{if(!p.uid||ids.has(p.uid))return false;ids.add(p.uid);return true;}).map(p=>p.name||people.find(o=>o.uid===p.uid)?.nombre||'—').join(', ')||'—';
}
function hours(run,at){const end=Math.min(new Date(at).getTime(),run.closed_at?new Date(run.closed_at).getTime():Infinity);const start=new Date(run.started_at).getTime();return Math.max(0,(end-start-(run.downtime_events||[]).reduce((sum,d)=>sum+Math.max(0,Math.min(end,new Date(d.end_at).getTime())-Math.max(start,new Date(d.start_at).getTime())),0))/3600000);}
export function supplyRows(snapshot,now=new Date()){
 return (snapshot.materials||[]).map(m=>{
  let pending=0,rate=0,missingRecipe=false;
  for(const r of snapshot.runs||[]){
   if(r.station_code!==m.station_code||new Date(r.closed_at||now)<new Date(m.tracked_at))continue;
   const recipe=(r.raw_recipe||[]).filter(l=>l.item_id===m.item_id),per=recipe.reduce((sum,l)=>sum+Number(l.per_unit),0);
   if(!r.closed_at&&!r.raw_recipe?.length)missingRecipe=true;
   if(!per)continue;
   const at=r.latest_at||r.started_at,working=hours(r,at);
   const uph=r.latest_at?(working>0?Number(r.latest_quantity||0)/working:0):Number(r.pieces_per_hour||0);
   const baseline=Number((snapshot.baselines||[]).find(b=>b.station_code===m.station_code&&b.item_id===m.item_id&&b.run_id===r.id)?.quantity||0);
   const produced=Math.max(Number(r.latest_quantity||0),baseline)+(r.closed_at?0:uph*Math.max(0,hours(r,now)-hours(r,new Date(Math.max(new Date(at).getTime(),new Date(m.tracked_at).getTime())))));
   pending+=Math.max(0,produced-Number(r.posted_quantity||0)-baseline)*per;
   if(!r.closed_at)rate+=uph*per;
  }
  const confirmed=Number(m.loaded_quantity)-Number(m.confirmed_consumption||0)+Number(m.confirmed_baseline||0);
  const estimated=confirmed-pending,minutes=rate>0?Math.max(0,estimated)/rate*60:null;
  const low=rate>0&&(estimated<=0||minutes!==null&&minutes<=15);
  return {...m,confirmed,pending,estimated,rate,minutes,low,missingRecipe};
 });
}
export function shiftCapture(edit,sessionId,runs,newId,reports=[]){
 const anchor=sessionId?.startsWith('closed:')?runs.find(r=>r.id===sessionId.slice(7)):null,anchorDraft=anchor&&reports.find(r=>r.live_run_id===anchor.id&&r.status==='draft');const siblings=anchor?runs.filter(r=>r.closed_at&&(r.session_id||r.id)===(anchor.session_id||anchor.id)):runs.filter(r=>(r.session_id||r.id)===sessionId&&!r.closed_at);if(!siblings.length)return {...edit,shift_session_id:'',live_run_id:null,products:edit.products?.map(p=>({...p,live_run_id:null}))};
 const first=siblings[0],date=new Date(first.started_at),end=first.closed_at?new Date(first.closed_at):null;
 const day=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const draft=reports.find(r=>r.live_run_id===first.id&&r.status==='draft');
 const products=siblings.map(r=>{
  const saved=(edit.products||[edit]).find(p=>p.live_run_id===r.id)||reports.find(p=>p.live_run_id===r.id&&p.status==='draft');
  const downtime_events=saved?.downtime_events??(r.downtime_events||[]).map(d=>({...d,...(['break','lunch'].includes(d.type)?{auto_minutes:(new Date(d.end_at)-new Date(d.start_at))/60000}:{}),start_time:new Date(d.start_at).toTimeString().slice(0,5),end_time:new Date(d.end_at).toTimeString().slice(0,5),minutes:String((new Date(d.end_at)-new Date(d.start_at))/60000)}));
  return {...saved,production_date:saved?.production_date||day(new Date(r.started_at)),start_time:String(saved?.start_time||new Date(r.started_at).toTimeString().slice(0,5)).slice(0,5),end_time:String(saved?.end_time||(r.closed_at?new Date(r.closed_at).toTimeString().slice(0,5):'')).slice(0,5),ends_next_day:saved?.ends_next_day??(r.closed_at?day(new Date(r.started_at))!==day(new Date(r.closed_at)):false),people:saved?.people??'',staff_names:saved?.staff_names||'',downtime_events,id:saved?.id||newId(),item_id:r.item_id,live_run_id:r.id,machine_quantity:saved?.machine_quantity??(r.latest_at?r.latest_quantity:''),scrap_quantity:saved?.scrap_quantity??'',rework_quantity:saved?.rework_quantity??'',full_boxes:saved?.full_boxes??'',pallets:saved?.pallets??'0',pieces_per_box:saved?.pieces_per_box??0,note:saved?.note??'',rework_completed:saved?.rework_completed??true,catalog_packing:saved?.catalog_packing??false};
 });
 const downtime_events=draft?.downtime_events||(first.downtime_events||[]).map(d=>({...d,start_time:new Date(d.start_at).toTimeString().slice(0,5),end_time:new Date(d.end_at).toTimeString().slice(0,5),minutes:String((new Date(d.end_at)-new Date(d.start_at))/60000)}));
 return {...edit,...draft,...products[0],products,machine_session_id:first.session_id||first.id,shift_session_id:sessionId,group_id:first.session_id||first.id,capture_group_id:draft?.capture_group_id||first.session_id||first.id,station_code:first.station_code,production_date:day(date),start_time:date.toTimeString().slice(0,5),end_time:end?end.toTimeString().slice(0,5):'',ends_next_day:end?day(date)!==day(end):false,people:draft?.people??'',report_mode:'production',downtime_events};
}
export function shiftOptions(runs,items,stations=[]){
 const seen=new Set();return runs.filter(r=>{const key=(r.session_id||r.id)+(r.closed_at?'|closed':'|active');if(seen.has(key))return false;seen.add(key);return true;}).map(r=>({value:r.closed_at?'closed:'+r.id:r.session_id||r.id,label:[r.station_code,stations.find(s=>s.code===r.station_code)?.name].filter(Boolean).join(' · ')+' · '+new Date(r.started_at).toLocaleString()+' · '+runs.filter(p=>(p.session_id||p.id)===(r.session_id||r.id)&&(!r.closed_at?!p.closed_at:!!p.closed_at)).map(p=>partLabel(items.find(i=>i.id===p.item_id))).join(' / ')}));
}

export function loadCounterRuns(data,edit){if(!edit||data.materials?.some(m=>m.station_code===edit.station_code&&m.item_id===edit.item_id))return [];return (data.runs||[]).filter(r=>!r.closed_at&&r.station_code===edit.station_code&&r.raw_recipe?.some(l=>l.item_id===edit.item_id));}

// RAW / SEMI inputs are assigned explicitly per workstation, independently of output BOMs.
// No assignment means an empty list, never the complete input catalog.
export function stationRawIds(data,stations,items,stationCode){
 if(!stationCode)return [];
 const station=stations.find(s=>s.code===stationCode);
 if(Array.isArray(station?.raw_material_ids))return items.filter(i=>i.active&&['RAW','SEMI'].includes(i.category)&&station.raw_material_ids.includes(i.id)).map(i=>i.id);
 const configured=(station?.materials||[]).flatMap(m=>m.item_ids||[m.item_id]);
 const ids=new Set([...configured,...(data.station_materials||[]).filter(m=>m.station_code===stationCode).map(m=>m.item_id)]);
 return items.filter(i=>i.active&&['RAW','SEMI'].includes(i.category)&&ids.has(i.id)).map(i=>i.id);
}
export function updateLoadEntry(edit,itemId,patch,getEntries){
 const entries=getEntries(edit).map(row=>row.item_id===itemId?{...row,...patch}:row);
 return {...edit,...(edit.item_id===itemId?patch:{}),entries};
}
export function materialLoadPayload(data,edit,getEntries){
 return {entries:getEntries(edit).map(row=>({...row,alert_minutes:15,baselines:loadCounterRuns(data,row).map(r=>({run_id:r.id,quantity:row.counters?.[r.id]??''}))}))};
}


// Match closed-session option IDs and retain a readable label after a run leaves the snapshot.
export function reportSession(edit,runs,items,stations,manualLabel){
 const options=[{value:'',label:manualLabel},...shiftOptions(runs,items,stations)];
 const run=runs.find(r=>r.id===edit.live_run_id);
 const value=run?(run.closed_at?'closed:'+run.id:run.session_id||run.id):edit.shift_session_id||edit.machine_session_id||'';
 if(value&&!options.some(o=>o.value===value))options.push({value,label:[edit.station_code,stations.find(s=>s.code===edit.station_code)?.name,edit.production_date].filter(Boolean).join(' · ')});
 return {value,options};
}
