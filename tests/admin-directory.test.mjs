import assert from 'node:assert/strict';
import {directoryPeople,reservedAdminUserId} from '../src/userDirectory.mjs';
import {departmentOperators} from '../src/shipping/departmentOperators.mjs';
const admin={uid:reservedAdminUserId,nombre:'Admin',activo:true,role:'supervisor'};
const supervisor={uid:'real-supervisor',nombre:'Admin',activo:true,role:'supervisor'};
const inactive={uid:'inactive-user',nombre:'Inactive',activo:false};
const rows=[admin,supervisor,inactive];
assert.deepEqual(directoryPeople(rows),[supervisor,inactive],'Exclude only the reserved account, even when another supervisor has the same name');
assert.deepEqual(rows,[admin,supervisor,inactive],'Keep identity and history source data intact');
assert.deepEqual(directoryPeople([{...admin,nombre:'Renamed',email:'changed@example.com'}]),[]);
assert.deepEqual(directoryPeople([]),[]);
for (const includeInactive of [false,true]) {
 const db={rpc:async(name,args)=>{assert.equal(name,'department_operators');assert.deepEqual(args,{p_department:'shipping',p_include_inactive:includeInactive});return {data:rows,error:null,count:3};}};
 const result=await departmentOperators(db,'shipping',includeInactive);
 assert.deepEqual(result.data,[supervisor,inactive]);
 assert.equal(result.count,3);
}
const denied={data:null,error:{message:'Department access required'}};
assert.equal(await departmentOperators({rpc:async()=>denied},'production'),denied);
console.log('PASS reserved Admin hidden; real supervisors and inactive filtering preserved; identity source and denied access intact');
