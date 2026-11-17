import {dailySignature} from './dailyDetails.mjs';
export function machineReportKey(row,runs=[]){const explicit=row.machine_session_id||runs.find(r=>r.id===row.live_run_id)?.session_id||row.shift_session_id||row.capture_group_id;return [row.station_code,row.production_date,explicit||dailySignature(row)].join('|');}
export function machineReviewRows(row,reports,runs=[]){return reports.filter(r=>machineReportKey(r,runs)===machineReportKey(row,runs));}
export function stationProductSummary(reports=[],reporterName=()=>null){const stations=new Map();for(const r of reports){if(!stations.has(r.station_code))stations.set(r.station_code,{code:r.station_code,products:[]});const station=stations.get(r.station_code);let product=station.products.find(p=>p.item_id===r.item_id);if(!product){product={item_id:r.item_id,reporters:new Set(),machine_quantity:0,good_quantity:0,scrap_quantity:0,rework_quantity:0,full_boxes:0};station.products.push(product);}const name=reporterName(r.created_by);if(name)product.reporters.add(name);for(const key of ['machine_quantity','good_quantity','scrap_quantity','rework_quantity','full_boxes'])product[key]+=Number(r[key]||0);}return [...stations.values()];}
export function machinePrintReports(reports,runs=[]){const seen=new Set();return reports.filter(r=>{const key=machineReportKey(r,runs);if(seen.has(key))return false;seen.add(key);return true;});}

export function machineReportGroups(reports, runs = []) {
 const groups = new Map();
 for (const report of reports) {
  const key = machineReportKey(report, runs);
  if (!groups.has(key)) groups.set(key, {key, reports: []});
  groups.get(key).reports.push(report);
 }
 return [...groups.values()];
}

export function datedStationSummary(reports=[],reporterName){
 const dates=new Map();
 for(const report of reports){
  const key=JSON.stringify([report.production_date,report.station_code]);
  if(!dates.has(key))dates.set(key,{key,production_date:report.production_date,code:report.station_code,reports:[]});
  dates.get(key).reports.push(report);
 }
 return [...dates.values()].map(group=>({...group,products:stationProductSummary(group.reports,reporterName)[0].products}));
}
export function summaryPrintReport(group,runs=[]){
 return {...group.reports[0],print_report_ids:machinePrintReports(group.reports,runs).map(report=>report.id),included_report_ids:group.reports.map(report=>report.id)};
}
