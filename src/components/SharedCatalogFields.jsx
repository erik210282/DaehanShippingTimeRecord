import React from 'react';
import { useTranslation } from 'react-i18next';
import { DSInput, DSSelect } from './controls';
export const catalogKinds={suppliers:'supplier',locations:'location',materials:'material'};
export const addressFields=['street','exterior_number','interior_number','neighborhood','city','state','postal_code','country','phone'];
export function catalogDefaults(kind){
 if(kind==='supplier')return {code:'',name:'',...Object.fromEntries(addressFields.map(k=>[k,''])),active:true};
 if(kind==='location')return {code:'',name:'',area:'',material_type:'RAW',active:true};
 return {code:'',name:'',category:'RAW',active:true};
}
export function materialLabel(type,t){return type?.builtin?t(`rc_${type.code}`):type?.name || '';}
export function CatalogSelect({label,value,onChange,options,multi=false,disabled=false}){
 const {t}=useTranslation();
 return <label className="catalog-field"><span>{label}</span><DSSelect aria-label={label} isMulti={multi} isDisabled={disabled} options={options} placeholder={t('rc_select')} value={multi?options.filter(o=>(value||[]).includes(o.value)):options.find(o=>o.value===value)||null} onChange={option=>onChange(multi?(option||[]).map(o=>o.value):option?.value||'')} styles={{menuPortal:base=>({...base,zIndex:10002})}}/></label>;
}
export function SharedCatalogFields({kind,edit,setEdit,materials}){
 const {t}=useTranslation();
 return <div className="catalog-fields">
 {['code','name',...(kind==='supplier'?addressFields:kind==='location'?['area']:[])].map(key=><CatalogInput key={key} label={t(`rc_${key}`)} aria-label={t(`rc_${key}`)} type={key==='phone'?'tel':'text'} value={kind==='material'&&key==='name'&&edit.builtin?materialLabel(edit,t):edit[key]||''} disabled={kind==='material'&&((key==='code'&&!!edit.id)||(key==='name'&&edit.builtin))} onChange={e=>setEdit({...edit,[key]:e.target.value})}/>)}
 {kind==='location'&&<CatalogSelect label={t('rc_type')} value={edit.material_type} onChange={material_type=>setEdit({...edit,material_type})} options={materials.filter(m=>m.active||m.code===edit.material_type).map(m=>({value:m.code,label:materialLabel(m,t)}))}/>}
 {kind==='material'&&<CatalogSelect disabled={edit.builtin} label={t('rc_stock_category')} value={edit.category} onChange={category=>setEdit({...edit,category})} options={['RAW','FG','PACKAGING','HOLD'].map(value=>({value,label:t(`rc_${value}`)}))}/>}
 <label className="catalog-checkbox"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>{t('rc_active')}</label>
 </div>;
}

export function CatalogInput({label, ...props}) {
 const text=label || props['aria-label'] || props.placeholder;
 return <label className="catalog-field"><span>{text}</span><DSInput {...props} aria-label={text} placeholder={props.placeholder || text}/></label>;
}
export function supplierAddress(supplier) {
 return ['street','exterior_number','interior_number','neighborhood','city','state','postal_code','country'].map(key=>supplier?.[key]).filter(Boolean).join(', ');
}
export function ProductCatalogFields({edit,setEdit,materials,locations,suppliers}) {
 const {t}=useTranslation();const raw=edit.category==='RAW',fg=edit.category==='FG',packing=edit.category==='PACKAGING';
 const input=(key,label,numeric=false)=><CatalogInput key={key} label={t(label)} type={numeric?'number':'text'} min={numeric?0:undefined} step={numeric?'any':undefined} value={edit[key]??''} onChange={e=>setEdit({...edit,[key]:e.target.value})}/>;
 return <div className="catalog-fields">
 <CatalogSelect label={t('rc_type')} value={edit.material_type} onChange={material_type=>setEdit({...edit,material_type,category:materials.find(type=>type.code===material_type)?.category})} options={materials.filter(type=>(type.active||type.code===edit.material_type)&&type.category!=='HOLD'&&(!edit.producto_id||type.category==='FG')).map(type=>({value:type.code,label:materialLabel(type,t)}))}/>
 {packing?<>{input('nombre','name')}{input('part_number','part_number')}</>:<>{input('part_number','part_number')}{input('nombre',raw?'rc_part_name':'name')}</>}{input('descripcion','description')}
 {packing&&<>{input('packing_weight','rc_packing_weight',true)}<CatalogInput label={t('rc_packing_measures')} placeholder={t('rc_packing_measures_example')} value={edit.packing_measures||''} onChange={e=>setEdit({...edit,packing_measures:e.target.value})}/></>}
 {input('minimum_quantity','inv_min_stock',true)}{input('uom','rc_uom')}
 <CatalogSelect multi label={t('rc_allowed')} value={edit.locations||[]} onChange={locations=>setEdit({...edit,locations})} options={locations.filter(location=>location.active&&!location.is_system_stage).map(location=>({value:location.id,label:location.code+' · '+location.name}))}/>
 {input('default_location',packing?'rc_preassigned_location':'inv_location')}
 {raw && <><CatalogSelect label={t('rc_supplier')} value={edit.supplier_id||''} onChange={supplier_id=>setEdit({...edit,supplier_id})} options={suppliers.filter(supplier=>supplier.active||supplier.id===edit.supplier_id).map(supplier=>({value:supplier.id,label:supplier.code+' · '+supplier.name}))}/>
 <CatalogInput label={t('rc_supplier_location')} readOnly value={supplierAddress(suppliers.find(supplier=>supplier.id===edit.supplier_id))}/>
 <CatalogInput label={t('rc_lead_time')} type="number" min="0" step="1" value={edit.lead_time_days??''} onChange={e=>setEdit({...edit,lead_time_days:e.target.value})}/></>}
 {fg && <>{input('peso_por_pieza','weight_piece',true)}{input('bin_type','bin_type')}{input('tipo_empaque_retornable','returnablebox')}{input('tipo_empaque_expendable','expendablebox')}{input('peso_caja_retornable','returnablebw',true)}{input('peso_caja_expendable','expendablebw',true)}{input('cantidad_por_caja_retornable','units_returnable',true)}{input('cantidad_por_caja_expendable','units_expendable',true)}</>}
 <label className="catalog-checkbox"><input type="checkbox" checked={!!edit.activo} onChange={e=>setEdit({...edit,activo:e.target.checked})}/>{t('active')}</label>
 </div>;
}
