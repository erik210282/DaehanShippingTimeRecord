import React from 'react';
import {useTranslation} from 'react-i18next';
import {allocationsFor,resolvePacking,optionLabel,packingError} from '../inventory/shippingPacking';
export default function ShippingPacking({model,disabled=false}) {
 const {t}=useTranslation();const {context,draft,change,add,remove}=model;
 if(model.loading)return <p role="status">{t('loading')}</p>;
 if(model.error)return <p role="alert">{packingError(model.error,t)} <button type="button" onClick={model.reload}>{t('sp_reload')}</button></p>;
 if(!context)return null;
 return <section className="inv-card"><h3>{t('sp_title')}</h3><p>{t('sp_help')}</p>
 {!context.lines.length&&<p role="alert">{t('sp_no_lines')}</p>}
 {context.lines.map(line=><fieldset key={line.id} disabled={disabled||(context.confirmed&&!line.historical)} style={{border:'1px solid #dbe3ed',borderRadius:8,marginBottom:12,padding:12}}>
 <legend>{line.product.part_number} | {line.cantidad_cajas} {t('inv_boxes')}</legend>
 {!line.options.length&&!line.allocations&&<p role="alert">{t('sp_unavailable')}</p>}
 {allocationsFor(line,draft).map((row,index)=>{
  const option=line.options.find(o=>o.option_id===row.option_id);
  const resolved=resolvePacking(line,[row])[0];
  return <div key={index} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:10}}>
   <label>{t('inv_boxes')}<input aria-label={t('inv_boxes')} type="number" min="1" step="1" value={row.boxes} onChange={e=>change(line,index,{boxes:e.target.value})} style={{width:85}}/></label>
   <label style={{flex:'1 1 320px'}}>{t('sp_variant')}<select aria-label={t('sp_variant')} style={{width:'100%'}} value={row.option_id} onChange={e=>{const o=line.options.find(o=>o.option_id===e.target.value);change(line,index,{option_id:e.target.value,material_id:o?.materials.length===1?o.materials[0].id:''});}}>
    <option value="">{t('select_pack')}</option>
    {row.pieces_per_box!=null&&!option&&<option value={row.option_id}>{row.material_part_number} | {row.pieces_per_box} {t('inv_pieces_per_box')}</option>}
    {line.options.filter(o=>o.option_id===row.option_id||!allocationsFor(line,draft).some(other=>other.option_id===o.option_id)).map(o=><option key={o.option_id} value={o.option_id}>{optionLabel(o,t)}</option>)}
   </select></label>
   <span>{resolved.pieces_per_box?`${t('rc_'+resolved.packing_type)} | ${resolved.pieces_per_box} ${t('inv_pieces_per_box')} | ${resolved.dimensions||''}`:''}</span>
   {allocationsFor(line,draft).length>1&&<button type="button" onClick={()=>remove(line,index)}>{t('delete')}</button>}
  </div>;
 })}
 <p>{allocationsFor(line,draft).reduce((sum,row)=>sum+Number(row.boxes||0),0)} / {line.cantidad_cajas} {t('inv_boxes')}</p>
 {line.options.length>allocationsFor(line,draft).length&&<button type="button" onClick={()=>add(line)}>{t('sp_split')}</button>}
 </fieldset>)}
 </section>;
}
