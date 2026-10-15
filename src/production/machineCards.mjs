// Presentation grouping preserves every run and its session identity.
export function machineGroups(runs=[]){
 const groups=new Map();
 for(const run of runs){const key=run.station_code||run.id;let group=groups.get(key);if(!group){group={key,station_code:run.station_code,runs:[]};groups.set(key,group);}group.runs.push(run);}
 return [...groups.values()].sort((a,b)=>Number(a.runs.every(r=>!!r.closed_at))-Number(b.runs.every(r=>!!r.closed_at)));
}
export function sessionGroups(runs=[]){
 const groups=new Map();
 for(const run of runs){const key=run.session_id||run.id;let group=groups.get(key);if(!group){group={key,runs:[]};groups.set(key,group);}group.runs.push(run);}
 return [...groups.values()];
}
export function splitRows(rows){
 return {shared:rows.filter(row=>row.values.length&&row.values.every(value=>value===row.values[0])),
 different:rows.filter(row=>!row.values.length||!row.values.every(value=>value===row.values[0]))};
}
