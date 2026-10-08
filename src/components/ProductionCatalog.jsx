import React, { useCallback, useEffect, useState } from 'react';
import { duplicateCatalogRow, hasDuplicateIdentifier } from '../catalog/duplication';
import Modal from 'react-modal';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase/client';
import { subscribeUpdates } from '../realtime';
import { CatalogInput, CatalogSelect } from './SharedCatalogFields';
import { BtnPrimary, BtnSecondary, BtnEditDark, BtnDanger, TablePagination } from './controls';

const unwrap = async query => { const { data, error } = await query; if(error) throw error; return data; };
export default function ProductionCatalog({ mode, access }) {
 const {t,i18n}=useTranslation();
 const [rows,setRows]=useState([]),[items,setItems]=useState([]),[products,setProducts]=useState([]);
 const [search,setSearch]=useState(''),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[expanded,setExpanded]=useState(null);
 const manage=!!(access?.admin || access?.memberships?.some(m=>['supervisor','lider'].includes(m.role)));
 const stations=mode==='stations';
 const refresh=useCallback(async()=>{
  const [r,i,p]=await Promise.all([
   unwrap(supabase.from(stations?'inventory_workstations':'inventory_boms').select(stations?'*':'*,inventory_bom_lines(*)').order(stations?'code':'product_part_number')),
   unwrap(supabase.from('inventory_items').select('id,producto_id,part_number,part_name,description,category,uom,active').order('part_number')),
   unwrap(supabase.from('productos').select('id,part_number,nombre,descripcion,activo')),
  ]);
  setRows((r||[]).filter(x=>!x.archived));setItems(i||[]);setProducts(p||[]);
 },[stations]);
 useEffect(()=>{let live=true;const load=()=>live&&refresh().catch(e=>setError(e.message));load();setEdit(null);setSearch('');setExpanded(null);
  const off=subscribeUpdates(supabase,'production-catalog-'+mode,['inventory_workstations','inventory_boms','inventory_bom_lines','catalog_updates','productos'],load);
  return()=>{live=false;off();};},[mode,refresh]);
 const productFor=r=>products.find(p=>p.id===items.find(i=>i.id===r.finished_item_id)?.producto_id || (p.part_number===r.product_part_number && p.part_number!=='NA'));
 const nameFor=r=>productFor(r)?.nombre||'—';
 const status=r=>!r.finished_item_id?'cat_pending_product':productFor(r)?.activo===false?'cat_inactive_product':r.active?'inv_active':'inv_draft';
 const visible=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(search.trim().toLowerCase()) || (!stations&&nameFor(r).toLowerCase().includes(search.trim().toLowerCase())));
 const totalPages=Math.max(1,Math.ceil(visible.length/pageSize)),currentPage=Math.min(page,totalPages);
 const fmt=value=>Number(value||0).toLocaleString(i18n.language,{maximumFractionDigits:6});
 async function perform(action){
  if(busy)return;setBusy(true);setError('');
  try{await action();await refresh();setEdit(null);}catch(e){setError(t(e.message,{defaultValue:e.message}));}finally{setBusy(false);}
 }
 function add(){
  setEdit(stations?{code:'',name:'',machine_type:'',materials:[],active:true,isNew:true}:{product_part_number:'',version:'',active:true,notes:'',lines:[{ingredient_id:'',quantity_per_unit:'',waste:'0'}],isNew:true});
 }
 function editRow(r){
  setEdit(stations?{...r,materials:r.materials.map(m=>({...m})),isNew:false}:{...r,lines:r.inventory_bom_lines.map(l=>({...l,waste:String(Number(l.waste_rate)*100)})),isNew:false});
 }
 function duplicate(r){
  if(!manage||busy)return;
  const copy=duplicateCatalogRow(r,stations?'code':'product_part_number');
  setEdit(stations?{...copy,materials:r.materials.map(m=>({...m})),isNew:true,duplicated:true}:{...copy,version:'',lines:r.inventory_bom_lines.map(l=>({...l,waste:String(Number(l.waste_rate)*100)})),isNew:true,duplicated:true});
 }
 async function save(){
  const key=stations?'code':'product_part_number';
  if(!edit[key]?.trim())throw Error('catalog_identifier_required');
  if(edit.isNew&&hasDuplicateIdentifier(rows,key,edit[key]))throw Error('catalog_duplicate_identifier');
  if(stations){
   if(!edit.code.trim()||!edit.name.trim()||!edit.machine_type.trim())throw Error('fill_all_fields');
   const payload={code:edit.code.trim().toUpperCase(),name:edit.name.trim(),machine_type:edit.machine_type.trim(),materials:edit.materials,active:!!edit.active};
   if(edit.isNew)await unwrap(supabase.from('inventory_workstations').insert(payload));
   else {const updated=await unwrap(supabase.from('inventory_workstations').update(payload).eq('code',edit.code).select('code'));if(!updated.length)throw Error('receiving_forbidden');}
  }else{
   const lines=edit.lines.map(l=>({ingredient_id:l.ingredient_id,quantity_per_unit:Number(l.quantity_per_unit),waste_rate:Number(l.waste)/100}));
   if(!edit.product_part_number.trim()||!lines.length||lines.some(l=>!l.ingredient_id||!Number.isFinite(l.quantity_per_unit)||l.quantity_per_unit<=0||!Number.isFinite(l.waste_rate)||l.waste_rate<0||l.waste_rate>=1))throw Error('catalog_recipe_required');
   await unwrap(supabase.rpc('inventory_catalog_recipe',{p_action:'save',p_data:{id:edit.id,product_part_number:edit.product_part_number,version:edit.version||null,active:edit.active,notes:edit.notes,lines}}));
  }
 }
 function remove(r){
  if(!window.confirm(t('cat_confirm_delete')))return;
  perform(async()=>{if(stations){const deleted=await unwrap(supabase.from('inventory_workstations').delete().eq('code',r.code).select('code'));if(!deleted.length)throw Error('receiving_forbidden');}
   else await unwrap(supabase.rpc('inventory_catalog_recipe',{p_action:'delete',p_data:{id:r.id}}));});
 }
 function updateLine(index,field,value){setEdit({...edit,lines:edit.lines.map((l,k)=>k===index?{...l,[field]:value}:l)});}
 const missing=products.filter(p=>p.activo&&p.part_number!=='NA'&&!rows.some(r=>r.product_part_number===p.part_number&&r.active&&r.inventory_bom_lines?.length));
 const editProduct=edit&&!stations?products.find(p=>p.part_number===edit.product_part_number):null;
 return <div className="catalog-production">
  <div className="catalog-actions">
   <CatalogInput label={t('search')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
   <BtnSecondary onClick={()=>{setSearch('');setPage(1);}}>{t('clear_filters')}</BtnSecondary>
   <BtnPrimary disabled={!manage||busy} onClick={add}>{t('add')}</BtnPrimary>
  </div>
  {error&&<p className="inv-message" role="alert">{error}</p>}
  {!stations&&<div className="catalog-recipe-notices">
   <details open><summary>{t('cat_missing_recipes',{count:missing.length})}</summary><div className="table-wrap"><table className="table"><thead><tr><th>{t('inv_ref_fg')}</th><th>{t('name')}</th><th>{t('description')}</th></tr></thead><tbody>{missing.map(p=><tr key={p.id}><td>{p.part_number}</td><td>{p.nombre}</td><td>{p.descripcion}</td></tr>)}</tbody></table></div></details>
  </div>}
  <div className="table-wrap catalog-table-scroll"><table className="table"><thead><tr>
   {stations?<><th>{t('inv_station_code')}</th><th>{t('name')}</th><th>{t('inv_station_type')}</th><th>{t('inv_station_materials')}</th></>:<><th>{t('inv_ref_fg')}</th><th>{t('name')}</th><th>{t('inv_version')}</th><th>{t('inv_recipe')}</th></>}
   <th>{t('status')}</th><th>{t('actions')}</th>
  </tr></thead><tbody>
   {visible.slice((currentPage-1)*pageSize,currentPage*pageSize).map(r=><React.Fragment key={r.id||r.code}><tr>
    {stations?<><td>{r.code}</td><td>{r.name}</td><td>{t(({Assembly:'inv_machine_ASY',Foaming:'inv_machine_FOA','WaterJet / Forming':'inv_machine_WAT','Press / Trim':'inv_machine_PRE',Forming:'inv_machine_PET'})[r.machine_type]||r.machine_type)}</td><td>{r.materials.map(m=>[m.erp_material,m.product||m.operation].filter(Boolean).join(' · ')).join(' / ')}</td></>:<><td>{r.product_part_number}</td><td>{nameFor(r)}</td><td>{r.version}</td><td><BtnSecondary onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{t('cat_ingredients',{count:r.inventory_bom_lines.length})}</BtnSecondary></td></>}
    <td>{t(stations?(r.active?'active':'inactive'):status(r))}</td>
    <td><BtnEditDark disabled={!manage||busy} onClick={()=>editRow(r)}>{t('edit')}</BtnEditDark> <BtnSecondary disabled={!manage||busy} onClick={()=>duplicate(r)}>{t('cat_duplicate')}</BtnSecondary> <BtnDanger disabled={!manage||busy} onClick={()=>remove(r)}>{t('delete')}</BtnDanger></td>
   </tr>
   {!stations&&expanded===r.id&&<tr><td colSpan="6"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('name')}</th><th>{t('inv_qty_per_fg')}</th><th>{t('inv_unit')}</th><th>{t('cat_waste')}</th></tr></thead><tbody>
    {r.inventory_bom_lines.map(l=>{const i=items.find(x=>x.id===l.ingredient_id);return <tr key={l.id}><td>{i?.part_number}</td><td>{i?.part_name||i?.description}</td><td>{fmt(l.quantity_per_unit)}</td><td>{i?.uom}</td><td>{fmt(Number(l.waste_rate)*100)}</td></tr>;})}
   </tbody></table></td></tr>}
   </React.Fragment>)}
   {!visible.length&&<tr><td colSpan="6">{t('no_results_found')}</td></tr>}
  </tbody></table><TablePagination totalRows={visible.length} page={currentPage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}}/></div>
  <Modal isOpen={!!edit} onRequestClose={()=>!busy&&setEdit(null)} style={{overlay:{zIndex:10000,backgroundColor:'#0008'},content:{width:'min(1100px, calc(100vw - 32px))',maxHeight:'88vh',inset:'50% auto auto 50%',transform:'translate(-50%,-50%)'}}}>
   {edit&&<form className="catalog-page" onSubmit={e=>{e.preventDefault();perform(save);}}>
    <h2>{t(stations?'inv_workstations':'inv_bom_title')} · {t(edit.isNew?'add':'edit')}</h2>
    {edit.duplicated&&<p>{t('cat_duplicate_help')}</p>}
    {edit.isNew&&edit[stations?'code':'product_part_number']?.trim()&&hasDuplicateIdentifier(rows,stations?'code':'product_part_number',edit[stations?'code':'product_part_number'])&&<p role="alert" className="inv-message">{t('catalog_duplicate_identifier')}</p>}
    <fieldset disabled={busy}><div className="catalog-fields">
    {stations?<><CatalogInput required label={t('inv_station_code')} disabled={!edit.isNew} value={edit.code} onChange={e=>setEdit({...edit,code:e.target.value})}/>
     <CatalogInput required label={t('name')} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/>
     <CatalogInput required label={t('inv_station_type')} value={edit.machine_type} onChange={e=>setEdit({...edit,machine_type:e.target.value})}/></>:<>
     <CatalogInput required label={t('inv_ref_fg')} list="recipe-products" value={edit.product_part_number} onChange={e=>setEdit({...edit,product_part_number:e.target.value.toUpperCase()})}/>
     <datalist id="recipe-products">{items.filter(i=>i.category==='FG').map(i=><option key={i.id} value={i.part_number}>{products.find(p=>p.id===i.producto_id)?.nombre}</option>)}</datalist>
     <CatalogInput label={t('name')} readOnly value={editProduct?.nombre||t('cat_pending_product')}/>
     <CatalogInput label={t('inv_version')} type="number" min="1" step="1" value={edit.version} onChange={e=>setEdit({...edit,version:e.target.value})}/>
     <CatalogInput label={t('inv_notes')} value={edit.notes||''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></>}
     <label className="catalog-checkbox"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>{t('active')}</label>
    </div>
    {stations?<><h3>{t('inv_station_materials')}</h3>{edit.materials.map((m,k)=><div className="catalog-fields" key={k}>
     <CatalogInput label={t('inv_part')} value={m.erp_material||''} onChange={e=>setEdit({...edit,materials:edit.materials.map((x,j)=>j===k?{...x,erp_material:e.target.value}:x)})}/>
     <CatalogInput label={t('name')} value={m.product||m.operation||''} onChange={e=>setEdit({...edit,materials:edit.materials.map((x,j)=>j===k?{...x,product:e.target.value}:x)})}/>
     <BtnDanger type="button" onClick={()=>setEdit({...edit,materials:edit.materials.filter((_,j)=>j!==k)})}>{t('delete')}</BtnDanger>
    </div>)}<BtnSecondary type="button" onClick={()=>setEdit({...edit,materials:[...edit.materials,{erp_material:'',product:''}]})}>{t('add')}</BtnSecondary></>:<>
     <h3>{t('inv_recipe')}</h3><div className="table-wrap"><table className="table"><thead><tr><th>{t('inv_part')}</th><th>{t('inv_qty_per_fg')}</th><th>{t('cat_waste')}</th><th>{t('actions')}</th></tr></thead><tbody>
     {edit.lines.map((l,k)=><tr key={k}><td><CatalogSelect label={t('inv_part')} value={l.ingredient_id} onChange={v=>updateLine(k,'ingredient_id',v)} options={items.filter(i=>['RAW','PACKAGING'].includes(i.category)&&(i.active||i.id===l.ingredient_id)).map(i=>({value:i.id,label:i.part_number+' · '+(i.part_name||i.description)+' ('+i.uom+')'}))}/></td>
      <td><CatalogInput required label={t('inv_qty_per_fg')} type="number" min="0.000001" step="any" value={l.quantity_per_unit} onChange={e=>updateLine(k,'quantity_per_unit',e.target.value)}/></td>
      <td><CatalogInput required label={t('cat_waste')} type="number" min="0" max="99.99" step="any" value={l.waste} onChange={e=>updateLine(k,'waste',e.target.value)}/></td>
      <td><BtnDanger type="button" onClick={()=>setEdit({...edit,lines:edit.lines.filter((_,j)=>j!==k)})}>{t('delete')}</BtnDanger></td></tr>)}
     </tbody></table></div>
     <BtnSecondary type="button" onClick={()=>setEdit({...edit,lines:[...edit.lines,{ingredient_id:'',quantity_per_unit:'',waste:'0'}]})}>{t('inv_add_ingredient')}</BtnSecondary>
    </>}
    </fieldset>
    {error&&<p role="alert" className="inv-message">{error}</p>}
    <div className="catalog-actions"><BtnPrimary disabled={busy||!manage||!edit[stations?'code':'product_part_number']?.trim()||(edit.isNew&&hasDuplicateIdentifier(rows,stations?'code':'product_part_number',edit[stations?'code':'product_part_number']))} type="submit">{t('save')}</BtnPrimary><BtnSecondary disabled={busy} type="button" onClick={()=>setEdit(null)}>{t('cancel')}</BtnSecondary></div>
   </form>}
  </Modal>
 </div>;
}
