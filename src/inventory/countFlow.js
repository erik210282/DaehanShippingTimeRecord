export function countGroups(captures){
 return Object.entries(captures).map(([key,values])=>{const [department,area]=key.split(':');return {department,area,lines:Object.entries(values).filter(([,v])=>v!==''&&v!==undefined).map(([item_id,v])=>({item_id,physical_quantity:Number(v)}))};}).filter(g=>g.lines.length);
}
export function countError(message,t){return t(/inventory_one_open_count/.test(message)?'inv_count_pending':message,{defaultValue:t('inv_count_error')});}
export function registerCountFlow(i18n){
 const resources={
 es:{inv_count_pending:'Ya hay un conteo pendiente de aprobación para esta área. Revísalo antes de enviar otro.',inv_count_error:'No se pudo procesar el conteo. Revisa los datos e inténtalo de nuevo.',inv_count_batch:'Solicitud de aprobación · todos los cambios',inv_count_batch_hint:'Puedes cambiar de tipo de material sin perder las cantidades. Envía el conteo al terminar todas las áreas.',inv_count_ready:'Cantidades por enviar: {{count}}'},
 en:{inv_count_pending:'A count for this area is already awaiting approval. Review it before submitting another.',inv_count_error:'The count could not be processed. Check the entries and try again.',inv_count_batch:'Approval request · all changes',inv_count_batch_hint:'You can switch material types without losing quantities. Submit after completing all areas.',inv_count_ready:'Quantities ready to submit: {{count}}'},
 ko:{inv_count_pending:'이 구역에 승인 대기 중인 실사가 있습니다. 새 실사를 제출하기 전에 검토하세요.',inv_count_error:'실사를 처리할 수 없습니다. 입력을 확인하고 다시 시도하세요.',inv_count_batch:'승인 요청 · 모든 변경 사항',inv_count_batch_hint:'자재 종류를 바꿔도 입력한 수량은 유지됩니다. 모든 구역을 완료한 후 제출하세요.',inv_count_ready:'제출할 수량: {{count}}'}
 };for(const [lang,translation] of Object.entries(resources))i18n.addResourceBundle(lang,'translation',translation,true,true);
}
