// Defaults are applied only by the workstation's onChange handler. Manual
// additions/removals must never be undone by a render or background refresh.
export function workstationProductIds(station,items,categories=['FG','SEMI'],fallback=[]){
 if(!station||station.active===false)return fallback;
 const ids=(station.materials||[]).flatMap(material=>{
  if(Array.isArray(material.item_ids))return material.item_ids;
  if(material.item_id)return [material.item_id];
  const part=String(material.client_part_number||'').trim().toUpperCase();
  return part?items.filter(item=>String(item.part_number||'').trim().toUpperCase()===part).map(item=>item.id):[];
 });
 const available=[...new Set(ids)].filter(id=>items.some(item=>item.id===id&&item.active&&categories.includes(item.category)));
 // Machines without configured matches must not erase a manual selection.
 return available.length?available:fallback;
}
