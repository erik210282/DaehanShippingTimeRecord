export function recipeMatches(row, query, items, outputName = '') {
 const term=String(query||'').trim().toLocaleLowerCase();
 if(!term)return true;
 const ids=new Set([row.finished_item_id,...(row.inventory_bom_lines||[]).map(l=>l.ingredient_id),...(row.inventory_bom_packaging||[]).flatMap(p=>(p.inventory_bom_packaging_lines||[]).map(l=>l.ingredient_id)),...(row.inventory_bom_packaging_lines||[]).map(l=>l.ingredient_id)]);
 return [row.product_part_number,outputName,row.notes,row.version,...items.filter(i=>ids.has(i.id)).flatMap(i=>[i.part_number,i.part_name,i.description,i.category,i.uom])].join(' ').toLocaleLowerCase().includes(term);
}
