// Output products belong to the selected workstation. Never reuse another machine's selection.
export function workstationProductIds(station,items,categories=['FG','SEMI']){
 if(!station||station.active===false)return [];
 const ids=(station.materials||[]).flatMap(material=>{
  if(Array.isArray(material.item_ids)&&material.item_ids.length)return material.item_ids;
  if(material.item_id)return [material.item_id];
  const part=String(material.client_part_number||'').trim().toUpperCase();
  return part?items.filter(item=>String(item.part_number||'').trim().toUpperCase()===part).map(item=>item.id):[];
 });
 return [...new Set(ids)].filter(id=>items.some(item=>item.id===id&&item.active!==false&&categories.includes(item.category)));
}
