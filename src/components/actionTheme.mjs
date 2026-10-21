// One palette for every department and role. Role checks belong to the caller.
export const actionPalette={primary:'#15803d',secondary:'#111111',edit:'#111111',danger:'#dc2626',text:'#ffffff'};
export function actionTone(label,t,preferred='primary',className=''){
 const text=String(label||'').replace(/^[^\p{L}\p{N}]+/u,'').trim().toLocaleLowerCase();
 const matches=keys=>keys.some(key=>{const value=t(key);return value!==key&&String(value).trim().toLocaleLowerCase()===text;});
 if(/(?:^|[ -])(?:danger|delete)(?:[ -]|$)/.test(className)||matches(['delete','cancel','rc_cancel','global_delete_unused','delete_conversation']))return 'danger';
 if(/(?:^|[ -])secondary(?:[ -]|$)/.test(className)||matches(['edit','close','pause','resume','pr_back','rc_close','clear_filters','clear_filter','export','export_excel','pr_export','global_copy_link','global_generate_link']))return 'secondary';
 return preferred==='edit'?'secondary':preferred;
}
