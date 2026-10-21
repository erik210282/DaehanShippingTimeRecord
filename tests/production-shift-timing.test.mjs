import assert from 'node:assert/strict';import fs from 'node:fs';
{const file=new URL('../src/production/shiftTiming.mjs',import.meta.url);
 const {shiftPlannedEnd,shiftDurationHours}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(file,'utf8')));
 const start=new Date(2026,9,21,6,0);
 for(const [hours,endHour,endMinute]of [[8,14,30],[10,16,30],[12,18,30]]){
  const end=shiftPlannedEnd(start,hours,8);assert.equal(end.getHours(),endHour);assert.equal(end.getMinutes(),endMinute);assert.equal(shiftDurationHours(hours,8),hours+.5);
 }
 const night=shiftPlannedEnd(new Date(2026,9,21,22,0),8,8);assert.equal(night.getDate(),22);assert.equal(night.getHours(),6);assert.equal(night.getMinutes(),30);
 assert.equal(shiftDurationHours(undefined,10),10.5);console.log('PASS',file,'8h/10h/custom + lunch, fallback and overnight end');
}