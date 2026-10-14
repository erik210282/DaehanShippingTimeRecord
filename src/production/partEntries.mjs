const fields=['id','item_id','hold_id','quantity','good_quantity','scrap_quantity','expected','counters'];
const pick=row=>Object.fromEntries(fields.map(key=>[key,row[key]]));
export function partEntries(edit){
 const entries=edit.entries|| (edit.item_id?[pick(edit)]:[]);
 return entries.map(row=>({...edit,...row,...(row.item_id===edit.item_id?pick(edit):{}),entries:undefined}));
}
export function selectPartEntries(edit,ids,newId){
 const saved=partEntries(edit),entries=[...new Set(ids)].map(item_id=>pick(saved.find(row=>row.item_id===item_id)||{id:newId(),item_id,hold_id:'',quantity:'',good_quantity:'',scrap_quantity:'',expected:'',counters:{}}));
 const current=entries.find(row=>row.item_id===edit.item_id)||entries[0];
 return {...edit,...(current||{item_id:'',hold_id:'',quantity:'',good_quantity:'',scrap_quantity:'',expected:'',counters:{}}),entries};
}
export function switchPartEntry(edit,item_id){
 const entries=partEntries(edit).map(pick);return {...edit,...entries.find(row=>row.item_id===item_id),entries};
}
export function selectReceiptParts(lines,index,ids){
 const row=lines[index],other=lines.filter((_,i)=>i!==index),selected=[...new Set(ids)].filter(id=>!other.some(line=>line.item_id===id));
 return [...lines.slice(0,index),...selected.map(item_id=>({...row,item_id,expected:item_id===row.item_id?row.expected:''})),...lines.slice(index+1)];
}
