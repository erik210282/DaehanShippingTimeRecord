
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CatalogInput,CatalogSelect } from './SharedCatalogFields';
import { BtnSecondary,BtnDanger } from './controls';
import { blankPackingLine } from '../production/model.mjs';
export default function RecipePackingFields({packing,setPacking,items}) {
 const {t}=useTranslation();
 const update=(index,patch)=>setPacking(packing.map((p,k)=>k===index?{...p,...patch}:p));
 return <section className="recipe-packing"><h3>{t('pr_packing_recipe')}</h3><p className="inv-muted">{t('pr_packing_hint')}</p>
 {!items.some(i=>i.category==='PACKAGING'&&i.active)&&<p className="inv-message">{t('pr_no_packing_items')}</p>}
 {packing.map((p,index)=><fieldset key={p.packaging_type} className="recipe-packing-variant">
  <legend>{p.box_name||t('pr_new_packing')}</legend>
  <><div className="catalog-fields">
   <CatalogInput label={t('pr_box_name')} required value={p.box_name} onChange={e=>update(index,{box_name:e.target.value})}/>
   <CatalogInput label={t('pr_pieces_per_box')} required type="number" min="1" step="1" value={p.pieces_per_box} onChange={e=>update(index,{pieces_per_box:e.target.value})}/>
   {p.lines.some(l=>l.basis==='pallet')&&<CatalogInput label={t('pr_boxes_per_pallet')} required type="number" min="1" step="1" value={p.boxes_per_pallet??''} onChange={e=>update(index,{boxes_per_pallet:e.target.value})}/>}
  </div><div className="table-wrap"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('quantity')}</th><th>{t('pr_basis')}</th><th>{t('cat_waste')}</th><th>{t('actions')}</th></tr></thead><tbody>
  {p.lines.map((l,k)=>{const set=(field,value)=>update(index,{lines:p.lines.map((x,j)=>j===k?{...x,[field]:value}:x)});return <tr key={k}>
   <td><CatalogSelect label={t('pr_packing_material')} value={l.ingredient_id} onChange={v=>set('ingredient_id',v)} options={items.filter(i=>i.category==='PACKAGING'&&(i.active||i.id===l.ingredient_id)).map(i=>({value:i.id,label:i.part_number+' · '+(i.part_name||i.description)+' ('+i.uom+')'}))}/></td>
   <td><CatalogInput label={t('quantity')} required type="number" min="0.000001" step="any" value={l.quantity} onChange={e=>set('quantity',e.target.value)}/></td>
   <td><CatalogSelect label={t('pr_basis')} value={l.basis} onChange={v=>set('basis',v)} options={['piece','box','pallet'].map(value=>({value,label:t('pr_per_'+value)}))}/></td>
   <td><CatalogInput label={t('cat_waste')} required type="number" min="0" max="99.99" step="any" value={l.waste} onChange={e=>set('waste',e.target.value)}/></td>
   <td><BtnDanger type="button" onClick={()=>update(index,{lines:p.lines.filter((_,j)=>j!==k)})}>{t('delete')}</BtnDanger></td>
  </tr>;})}</tbody></table></div>
  <BtnSecondary type="button" onClick={()=>update(index,{lines:[...p.lines,blankPackingLine()]})}>{t('pr_add_packing')}</BtnSecondary>
  <BtnDanger type="button" onClick={()=>setPacking(packing.filter((_,k)=>k!==index))}>{t('pr_delete_packing')}</BtnDanger>
  </>
 </fieldset>)}
 <BtnSecondary type="button" onClick={()=>setPacking([...packing,{packaging_type:crypto.randomUUID(),enabled:true,box_name:'',pieces_per_box:'',boxes_per_pallet:'',lines:[blankPackingLine()]}])}>{t('pr_add_packing_type')}</BtnSecondary>
 </section>;
}
