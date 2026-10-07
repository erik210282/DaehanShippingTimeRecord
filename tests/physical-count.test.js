import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhysicalCount } from '../src/inventory/physicalCounts.js';
const items=[{id:'a',part_number:'TEST-A',uom:'EA'},{id:'b',part_number:'TEST-B',uom:'KG'}];
const t=(key,data={})=>key+JSON.stringify(data);
test('explicit zero remains a count; blank cells are omitted',()=>{
 assert.deepEqual(parsePhysicalCount([{'Part Number':'TEST-A','Physical Quantity':0},{'Part Number':'TEST-B','Physical Quantity':''}],items,t),{a:'0'});
});
test('decimal counts preserve precision and translated headers work',()=>{
 const translated=(key,data)=>key==='inv_part'?'Parte':key==='inv_physical'?'Físico':key==='inv_unit'?'Unidad':t(key,data);
 assert.deepEqual(parsePhysicalCount([{Parte:'test-b',Físico:0.25,Unidad:'KG'}],items,translated),{b:'0.25'});
});
test('unknown parts prevent importing a partial file',()=>{
 assert.throws(()=>parsePhysicalCount([{'Part Number':'TEST-A','Physical Quantity':1},{'Part Number':'UNKNOWN','Physical Quantity':2}],items,t),/inv_unknown_part/);
});
test('duplicate counted parts cannot overwrite each other',()=>{
 assert.throws(()=>parsePhysicalCount([{'Part Number':'TEST-A','Physical Quantity':1},{'Part Number':'test-a','Physical Quantity':2}],items,t),/count_duplicate/);
});
test('negative, non-finite and non-numeric quantities are rejected',()=>{
 for(const quantity of [-1,'Infinity','NaN','abc'])assert.throws(()=>parsePhysicalCount([{'Part Number':'TEST-A','Physical Quantity':quantity}],items,t),/count_invalid_row/);
});
test('incompatible units cannot change the count',()=>{
 assert.throws(()=>parsePhysicalCount([{'Part Number':'TEST-B','Physical Quantity':1,Unit:'EA'}],items,t),/count_invalid_row/);
});
test('a template without counted quantities is not an inventory of zeros',()=>{
 assert.throws(()=>parsePhysicalCount([{'Part Number':'TEST-A','Physical Quantity':''}],items,t),/inv_file_empty/);
});
