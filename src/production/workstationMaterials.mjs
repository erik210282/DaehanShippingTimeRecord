export function materialProduct(material,items){return items.find(i=>i.id===material.item_id);}
export function linkedMaterial(material,item){return {...material,item_id:item?.id||null,client_part_number:item?.part_number||'',client_part_name:item?.part_name||item?.description||''};}
export function materialItemIds(material){return Array.isArray(material.item_ids)?material.item_ids:material.item_id?[material.item_id]:[];}
export function materialClientLabel(material,items){
 const ids=materialItemIds(material);
 return (ids.length?ids:[null]).map(id=>{const item=items.find(i=>i.id===id);return [item?.part_number||material.client_part_number,item?.part_name||item?.description||material.client_part_name].filter(Boolean).join(' - ');}).filter(Boolean).join(' / ');
}
// Keep the stored JSON compatible with existing production and mobile readers:
// one linked item per entry, grouped into a multiple selector in the editor.
export function groupWorkstationMaterials(materials=[]){
 const groups=new Map();
 for(const material of materials){
  const key=JSON.stringify([String(material.erp_material||'').trim().toUpperCase(),material.product||material.operation||'']);
  if(!groups.has(key))groups.set(key,{...material,item_ids:[]});
  const group=groups.get(key);
  group.item_ids=[...new Set([...group.item_ids,...materialItemIds(material)])];
 }
 return [...groups.values()];
}
export function expandWorkstationMaterials(materials,items){
 return materials.flatMap(material=>{
  const {item_ids,...base}=material,ids=materialItemIds(material);
  if(ids.length)return ids.map(id=>{const item=items.find(i=>i.id===id);return item?linkedMaterial(base,item):{...base,item_id:id};});
  return [{...base,item_id:null,...(base.item_id?{client_part_number:'',client_part_name:''}:{})}];
 });
}
export function validWorkstationMaterials(materials,items){const seen=new Set();return materials.every(m=>{const code=String(m.erp_material||'').trim().toUpperCase(),key=JSON.stringify([code,m.item_id||null]);if(!code||!String(m.product||m.operation||'').trim()||seen.has(key))return false;seen.add(key);return !m.item_id||items.some(i=>i.id===m.item_id&&['SEMI','FG'].includes(i.category));});}
