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
 return <label style={{display:'grid',gap:6}}><span>{label}</span><DSSelect aria-label={label} isMulti={multi} isDisabled={disabled} options={options} placeholder={t('rc_select')} value={multi?options.filter(o=>(value||[]).includes(o.value)):options.find(o=>o.value===value)||null} onChange={option=>onChange(multi?(option||[]).map(o=>o.value):option?.value||'')} styles={{menuPortal:base=>({...base,zIndex:10002})}}/></label>;
}
export function SharedCatalogFields({kind,edit,setEdit,materials}){
 const {t}=useTranslation();
 return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
 {['code','name',...(kind==='supplier'?addressFields:kind==='location'?['area']:[])].map(key=><label key={key}><span>{t(`rc_${key}`)}</span><DSInput aria-label={t(`rc_${key}`)} type={key==='phone'?'tel':'text'} value={edit[key]||''} disabled={kind==='material'&&key==='code'&&!!edit.id} onChange={e=>setEdit({...edit,[key]:e.target.value})}/></label>)}
 {kind==='location'&&<CatalogSelect label={t('rc_type')} value={edit.material_type} onChange={material_type=>setEdit({...edit,material_type})} options={materials.filter(m=>m.active||m.code===edit.material_type).map(m=>({value:m.code,label:materialLabel(m,t)}))}/>}
 {kind==='material'&&<CatalogSelect disabled={edit.builtin} label={t('rc_stock_category')} value={edit.category} onChange={category=>setEdit({...edit,category})} options={['RAW','FG','PACKAGING','HOLD'].map(value=>({value,label:t(`rc_${value}`)}))}/>}
 <label><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>{t('rc_active')}</label>
 </div>;
}
