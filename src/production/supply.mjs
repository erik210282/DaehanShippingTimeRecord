
export function partLabel(item){return [item?.part_number,item?.productos?.nombre||item?.part_name||item?.description].filter(Boolean).join(' · ');}
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
  const low=estimated<=0||minutes!==null&&minutes<=Number(m.alert_minutes);
  return {...m,confirmed,pending,estimated,rate,minutes,low,missingRecipe};
 });
}
export function shiftCapture(edit,sessionId,runs,newId){
 const siblings=runs.filter(r=>r.session_id===sessionId);if(!siblings.length)return {...edit,shift_session_id:'',live_run_id:null,products:edit.products?.map(p=>({...p,live_run_id:null}))};
 const first=siblings[0],date=new Date(first.started_at),end=first.closed_at?new Date(first.closed_at):null;
 const day=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const previous=edit.products||[edit];
 const products=siblings.map(r=>({...previous.find(p=>p.item_id===r.item_id),id:previous.find(p=>p.item_id===r.item_id)?.id||newId(),item_id:r.item_id,live_run_id:r.id,machine_quantity:previous.find(p=>p.item_id===r.item_id)?.machine_quantity??'',scrap_quantity:previous.find(p=>p.item_id===r.item_id)?.scrap_quantity??'',rework_quantity:previous.find(p=>p.item_id===r.item_id)?.rework_quantity??'',full_boxes:previous.find(p=>p.item_id===r.item_id)?.full_boxes??'',pallets:'0',pieces_per_box:0,note:'',rework_completed:true,catalog_packing:false}));
 return {...edit,...products[0],products,shift_session_id:sessionId,station_code:first.station_code,production_date:day(date),start_time:date.toTimeString().slice(0,5),end_time:end?end.toTimeString().slice(0,5):'',ends_next_day:end?day(date)!==day(end):false};
}
export function shiftOptions(runs,items){
 const seen=new Set();return runs.filter(r=>{if(seen.has(r.session_id))return false;seen.add(r.session_id);return true;}).map(r=>({value:r.session_id,label:r.station_code+' · '+new Date(r.started_at).toLocaleString()+' · '+runs.filter(p=>p.session_id===r.session_id).map(p=>partLabel(items.find(i=>i.id===p.item_id))).join(' / ')}));
}

export function loadCounterRuns(data,edit){if(!edit||data.materials?.some(m=>m.station_code===edit.station_code&&m.item_id===edit.item_id))return [];return (data.runs||[]).filter(r=>!r.closed_at&&r.station_code===edit.station_code&&r.raw_recipe?.some(l=>l.item_id===edit.item_id));}
