const eventKey=event=>event._downtime_key||JSON.stringify([event.type,event.start_time??event.start_at??'',event.end_time??event.end_at??'',Number(event.minutes)||0,event.note||'']);
let sequence=0;
export function affectedIds(edit,products=edit?.products||[]){
 const available=products.map(p=>p.item_id);
 return (edit?.downtime_item_ids??(edit?.downtime_item_id?[edit.downtime_item_id]:available)).filter(id=>available.includes(id));
}
export function selectedDowntime(edit,products=edit?.products||[]){
 if(products.length<=1)return edit?.downtime_events||products[0]?.downtime_events||[];
 const selected=new Set(affectedIds(edit,products)),events=new Map();
 for(const p of products)if(selected.has(p.item_id))for(const event of p.downtime_events||[]){const key=eventKey(event);if(!events.has(key))events.set(key,{...event,_downtime_key:key});}
 return [...events.values()];
}
export function applySelectedDowntime(edit,events,products=edit?.products||[]){
 if(products.length<=1)return {...edit,downtime_events:events};
 const selected=new Set(affectedIds(edit,products));if(!selected.size)return edit;
 const before=new Map(selectedDowntime(edit,products).map(e=>[eventKey(e),e]));
 const next=events.map(e=>({...e,_downtime_key:e._downtime_key||'new:'+Date.now()+':'+(++sequence)}));
 const after=new Map(next.map(e=>[eventKey(e),e]));
 const added=next.filter(e=>!before.has(eventKey(e)));
 const updated=products.map(p=>!selected.has(p.item_id)?p:{...p,downtime_events:[...(p.downtime_events||[]).filter(e=>!before.has(eventKey(e))||after.has(eventKey(e))).map(e=>after.get(eventKey(e))||e),...added]});
 return {...edit,products:updated,downtime_events:updated.find(p=>p.item_id===edit.item_id)?.downtime_events||edit.downtime_events||[]};
}
