
export function fieldLabel(field,t){return field.key?t('pp_'+field.key,{defaultValue:field.label}):field.label;}
export function matchingTemplates(templates,station,itemIds=[]){
 if(!station)return [];
 return templates.filter(t=>t.active&&t.machine_types.includes(station.machine_type)&&(!t.station_code||t.station_code===station.code)&&(!(t.item_ids?.length||t.item_id)||itemIds.length>0&&itemIds.every(id=>(t.item_ids?.length?t.item_ids:[t.item_id]).includes(id)))).sort((a,b)=>(Number(!!b.station_code)*2+Number(!!(b.item_ids?.length||b.item_id)))-(Number(!!a.station_code)*2+Number(!!(a.item_ids?.length||a.item_id)))||a.name.localeCompare(b.name));
}
export function blankParameter(newId){return {id:newId(),label:'',unit:'',reference:'',input_type:'numeric',minimum:'',maximum:''};}
export function blankTemplate(newId){return {id:newId(),name:'',machine_types:[],station_code:'',item_id:'',fields:[blankParameter(newId)]};}
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
