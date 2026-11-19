import {reportNeedsCompletion} from './machineReports.mjs';
export async function loadDailyPrintContext(client,report){
 const ids=report.print_report_ids||[report.id];
 const contexts=await Promise.all(ids.map(async id=>{
  const {data,error}=await client.rpc('production_daily_print_context',{p_report:id});
  if(error)throw error;
  return data;
 }));
 const included=report.included_report_ids&&new Set(report.included_report_ids);
 const rows=new Map(),staff=new Map(),codes=new Map();
 for(const context of contexts){
  for(const row of context.reports||[])if(!included||included.has(row.id))rows.set(row.id,row);
  for(const person of context.staff||[])staff.set(person.id||person.uid||person.name,person);
  for(const code of context.codes||[])codes.set(code.id||code.code,code);
 }
 if([...rows.values()].some(reportNeedsCompletion))throw Error('dt_pdf_missing');
 return {...contexts[0],reports:[...rows.values()],staff:[...staff.values()],codes:[...codes.values()]};
}
