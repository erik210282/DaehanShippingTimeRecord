import test from 'node:test';
import assert from 'node:assert/strict';
import {receivingError} from '../src/receiving/translations.js';
const t=(key,options)=>({
 catalog_duplicate_identifier:'Duplicate identifier',
 catalog_target_recipe_differs:'Different recipe',
 rc_receiving_forbidden:'Forbidden',
 rc_error:'Generic error',
 rc_duplicate:'Duplicate',
}[key]??options?.defaultValue??key);
test('catalog exceptions use their specific translated message',()=>{
 assert.equal(receivingError({message:'catalog_duplicate_identifier'},t),'Duplicate identifier');
 assert.equal(receivingError({message:'catalog_target_recipe_differs'},t),'Different recipe');
});
test('legacy receiving and constraint errors retain their translations',()=>{
 assert.equal(receivingError({message:'receiving_forbidden'},t),'Forbidden');
 assert.equal(receivingError({code:'23505'},t),'Duplicate');
 assert.equal(receivingError({message:'unexpected'},t),'Generic error');
});
