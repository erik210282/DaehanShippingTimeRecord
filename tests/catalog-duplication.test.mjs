import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogIdentifier,duplicateCatalogRow,hasDuplicateIdentifier} from '../src/catalog/duplication.js';

test('duplicate keeps editable data and clears identities without changing the original',()=>{
 const source={id:'original',inventory_id:'stock',producto_id:'product',part_number:'EXAMPLE-A',nombre:'Shared name',descripcion:'Shared description',locations:['one'],builtin:true};
 const copy=duplicateCatalogRow(source,'part_number');
 assert.equal(copy.part_number,'');
 assert.equal(copy.nombre,source.nombre);
 assert.equal(copy.descripcion,source.descripcion);
 for(const field of ['id','inventory_id','producto_id','builtin'])assert.equal(copy[field],undefined);
 copy.locations.push('two');
 assert.deepEqual(source.locations,['one']);
 assert.equal(source.part_number,'EXAMPLE-A');
});
test('duplicate identifiers ignore case and surrounding spaces',()=>{
 assert.equal(hasDuplicateIdentifier([{part_number:'EXAMPLE-A'}],'part_number',' example-a '),true);
 assert.equal(hasDuplicateIdentifier([{part_number:'EXAMPLE-A'}],'part_number','EXAMPLE-B'),false);
});
test('each catalog clears its own identifier',()=>{
 for(const [tab,kind,key] of [['productos',null,'part_number'],['pos',null,'po'],['shipper',null,'shipper_name'],['actividades',null,'nombre'],['suppliers','supplier','code'],['locations','location','code'],['materials','material','code'],['stations',null,'code'],['bom',null,'product_part_number']]) {
  assert.equal(catalogIdentifier(tab,kind),key);
  assert.equal(duplicateCatalogRow({[key]:'original'},key)[key],'');
 }
});
