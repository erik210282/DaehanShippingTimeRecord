// UI contract: choose intent at the call site. Never infer colors from translated text.
export const uiTokens={create:'#2563eb',confirm:'#15803d',neutral:'#111111',danger:'#dc2626',field:'#333333',fieldBorder:'#555555',text:'#ffffff',placeholder:'#c4c4c4',controlHeight:44,controlRadius:10};
const acronyms=new Set(['RAW','SEMI','FG','WIP','BOM','BOL','IDX','PO','PN','PDF','CSV','XLSX','UPH','OEE','EDI','DOH','KPI','ID','NFC','QR','URL','API','DOCK','PC','PCS']);
export function uiTitle(value){if(typeof value!=='string')return value;return value.replace(/[\p{L}\p{N}]+(?:[-_/][\p{L}\p{N}]+)*/gu,word=>{if(/\d/.test(word)||acronyms.has(word.toUpperCase()))return acronyms.has(word.toUpperCase())?word.toUpperCase():word;const lower=word.toLocaleLowerCase();return lower.charAt(0).toLocaleUpperCase()+lower.slice(1);});}
export function resolveIntent(intent,tone){return ['create','confirm','neutral','danger'].includes(intent)?intent:({primary:'create',secondary:'neutral',edit:'neutral',danger:'danger'})[tone]||'neutral';}
export function actionLabel(label,intent){const text=uiTitle(String(label??'').replace(/[➕＋]/g,'+').trim());return intent==='create'?'+ '+text.replace(/^\+\s*/,''):text;}
// Compatibility exports: these map semantics, never a language-dependent label.
export const actionPalette={primary:uiTokens.create,secondary:uiTokens.neutral,edit:uiTokens.neutral,danger:uiTokens.danger,text:uiTokens.text};
export const actionTone=(_label,_t,preferred)=>resolveIntent(undefined,preferred);
