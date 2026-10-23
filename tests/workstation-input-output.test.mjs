import assert from 'node:assert/strict';
import test from 'node:test';
import {validWorkstationMaterials,groupWorkstationMaterials,expandWorkstationMaterials} from '../src/production/workstationMaterials.mjs';
import {workstationProductIds} from '../src/production/workstationDefaults.mjs';

test('workstation outputs resolve to registered SEMI/FG codes independently of RAW/SEMI inputs',()=>{
 const items=[{id:'raw',part_number:'IN-RAW',category:'RAW',active:true},{id:'semi-in',part_number:'IN-SEMI',category:'SEMI',active:true},{id:'semi-out',part_number:'OUT-SEMI',category:'SEMI',active:true},{id:'fg',part_number:'OUT-FG',category:'FG',active:true}];
 const row={erp_material:'ERP-01',product:'Output Reference',item_ids:['semi-out','fg']};
 const expanded=expandWorkstationMaterials([row],items);
 assert.equal(validWorkstationMaterials(expanded,items),true);
 assert.deepEqual(expanded.map(m=>m.client_part_number),['OUT-SEMI','OUT-FG']);
 assert.equal(validWorkstationMaterials([{...expanded[0],item_id:'raw'}],items),false);
 assert.deepEqual(groupWorkstationMaterials(expanded)[0].item_ids,['semi-out','fg']);
 assert.deepEqual(workstationProductIds({active:true,raw_material_ids:['raw','semi-in'],materials:expanded},items),['semi-out','fg']);
});
