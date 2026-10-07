const text = v => String(v ?? '').trim();
export function parsePhysicalCount(rows, items, t) {
 const next = {}, issues = [];
 for (let k = 0; k < rows.length; k++) {
  const r=rows[k], normalized=Object.fromEntries(Object.entries(r).map(([a,b])=>[a.toLowerCase().replace(/[\s_]+/g,''),b]));
  const pn=text(r['Part Number']??r.part_number??r.Parte??r.Part??r[t('inv_part')]??normalized.partnumber).toUpperCase();
  const raw=text(r['Physical Quantity']??r.physical_quantity??r.Fisico??r.Físico??r.Physical??r[t('inv_physical')]??normalized.physicalquantity);
  if (!pn && !raw) continue;
  const item=items.find(i=>i.part_number.toUpperCase()===pn);
  if (!item) { issues.push(t('inv_unknown_part',{part:pn||String(k+2)})); continue; }
  if (raw==='') continue;
  const number=Number(raw), unit=text(r.Unit??r.UOM??r[t('inv_unit')]);
  if (!Number.isFinite(number)||number<0||(unit&&unit.toUpperCase()!==item.uom.toUpperCase())) {
   issues.push(t('count_invalid_row',{row:k+2,part:pn})); continue;
  }
  if (next[item.id]!==undefined) { issues.push(t('count_duplicate',{part:pn})); continue; }
  next[item.id]=String(number);
 }
 if (issues.length) throw Error(issues.slice(0,10).join('\n'));
 if (!Object.keys(next).length) throw Error(t('inv_file_empty'));
 return next;
}
