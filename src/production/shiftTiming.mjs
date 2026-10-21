// Planned hours exclude the fixed 30-minute lunch.
export function shiftDurationHours(planned,reference){
 const hours=Number(planned||reference);return Number.isFinite(hours)&&hours>0?hours+0.5:0;
}
export function shiftPlannedEnd(startedAt,planned,reference){
 return new Date(new Date(startedAt).getTime()+shiftDurationHours(planned,reference)*3600000);
}
