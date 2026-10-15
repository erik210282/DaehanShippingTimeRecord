
export function fieldLabel(field,t){return field.key?t('pp_'+field.key,{defaultValue:field.label}):field.label;}
export function matchingTemplates(templates,station,itemIds=[]){
 if(!station)return [];
 return templates.filter(t=>t.active&&t.machine_types.includes(station.machine_type)&&(!t.station_code||t.station_code===station.code)&&(!(t.item_ids?.length||t.item_id)||itemIds.length>0&&itemIds.every(id=>(t.item_ids?.length?t.item_ids:[t.item_id]).includes(id)))).sort((a,b)=>(Number(!!b.station_code)*2+Number(!!(b.item_ids?.length||b.item_id)))-(Number(!!a.station_code)*2+Number(!!(a.item_ids?.length||a.item_id)))||a.name.localeCompare(b.name));
}
export function blankParameter(newId){return {id:newId(),label:'',unit:'',reference:'',input_type:'numeric',minimum:'',maximum:''};}
export function blankTemplate(newId){return {id:newId(),name:'',machine_types:[],station_code:'',item_id:'',fields:[blankParameter(newId)]};}
export function referenceBounds(reference){
 const text=String(reference??'').trim().replace(/\+\s*\/\s*-/g,'±');
 const number='([+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+))';
 const tolerance=text.match(new RegExp('^'+number+'\\s*±\\s*'+number+'(?![\\d.,])\\s*(%)?'));
 const range=text.match(new RegExp('^'+number+'\\s*(?:–|—|-|~|\\bto\\b|\\ba\\b)\\s*'+number+'(?![\\d.,])','i'));
 const match=tolerance||range;if(!match)return null;
 const a=Number(match[1].replace(',','.')),b=Number(match[2].replace(',','.'));
 if(!Number.isFinite(a)||!Number.isFinite(b)||tolerance&&b<0)return null;
 const delta=tolerance?(match[3]?Math.abs(a)*b/100:b):0;
 const minimum=tolerance?a-delta:a,maximum=tolerance?a+delta:b;
 if(!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum>maximum)return null;
 return {minimum:Number(minimum.toPrecision(12)),maximum:Number(maximum.toPrecision(12))};
}
export function parameterField(field,patch={}){
 const next={...field,...patch};
 if(next.input_type==='text')return {...next,minimum:'',maximum:''};
 const bounds=referenceBounds(next.reference);
 return bounds?{...next,...bounds}:('reference' in patch?{...next,minimum:'',maximum:''}:next);
}
export function editTemplate(template){return {...template,station_code:template.station_code||'',item_id:template.item_id||'',item_ids:template.item_ids?.length?[...template.item_ids]:template.item_id?[template.item_id]:[],machine_types:[...(template.machine_types||[])],fields:template.fields.map(f=>parameterField({...f,minimum:f.minimum??'',maximum:f.maximum??''}))};}
export function duplicateTemplate(template,newId){
 const copy=editTemplate(template);
 return {id:newId(),name:'',duplicate_source_name:template.name,active:true,machine_types:copy.machine_types,station_code:copy.station_code,item_id:copy.item_id,item_ids:copy.item_ids,fields:copy.fields.map(f=>({...f,id:newId()}))};
}
export function templateProblem(edit,templates){
 if(!edit.duplicate_source_name)return null;
 const normalized=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
 if(!normalized(edit.name)||normalized(edit.name)===normalized(edit.duplicate_source_name))return 'pp_duplicate_rename';
 if(templates.some(t=>t.id!==edit.id&&normalized(t.name)===normalized(edit.name)))return 'pp_duplicate_name_exists';
 return null;
}
export function templateGroups(templates){
 const groups=new Map();
 for(const template of templates){for(const type of new Set(template.machine_types?.length?template.machine_types:['__unassigned'])){
  if(!groups.has(type))groups.set(type,[]);groups.get(type).push(template);
 }}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([type,templates])=>({type,templates:[...templates].sort((a,b)=>a.name.localeCompare(b.name))}));
}
export function readingOutside(field,value){const n=Number(String(value).replace(',','.'));return field.input_type==='numeric'&&String(value).trim()!==''&&Number.isFinite(n)&&(field.minimum!==''&&field.minimum!=null&&n<Number(field.minimum)||field.maximum!==''&&field.maximum!=null&&n>Number(field.maximum));}
export function captureProblem(edit){
 if(!edit.station_code||!edit.item_ids?.length||!edit.template?.fields?.length)return 'pp_select';
 for(const f of edit.template.fields){const v=String(edit.values[f.id]?.value??'').trim().replace(',','.');if(!v||v.length>500||f.input_type==='numeric'&&!/^-?\d+(\.\d+)?$/.test(v))return 'pp_values_required';}
 return null;
}
export function captureValues(edit){return edit.template.fields.map(f=>{const value=String(edit.values[f.id]?.value??'').trim();return {id:f.id,value:f.input_type==='numeric'?value.replace(',','.'):value,note:edit.values[f.id]?.note||''};});}
export function scopeCapture(edit,patch,templates,stations){const next={...edit,...patch},options=matchingTemplates(templates,stations.find(s=>s.code===next.station_code),next.item_ids),template=options.find(c=>c.id===edit.template?.id)||options[0]||null,keep=next.station_code===edit.station_code&&template?.id===edit.template?.id&&template?.version===edit.template?.version;return {...next,template,values:keep?edit.values:{}};}


export function currentParameterTime(now=new Date()){return String(now.getHours()).padStart(2,"0")+String(now.getMinutes()).padStart(2,"0");}
export function reportProducts(report){return report.products?.length?report.products.map(p=>p.part_number+" · "+p.part_name).join(" / "):report.part_number+" · "+report.part_name;}

export function editParameterReport(report){return {id:report.capture_group_id,date:report.recorded_date,time:report.recorded_time.slice(0,5).replace(':',''),station_code:report.station_code,item_ids:report.products?.map(p=>p.item_id)||[report.item_id],template:{id:report.template_id,version:report.template_version,fields:report.readings},values:Object.fromEntries(report.readings.map(f=>[f.id,{value:f.value,note:f.note||''}])),note:report.note||'',original:report};}
