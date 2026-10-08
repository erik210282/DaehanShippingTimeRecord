import assert from 'node:assert/strict';
import {recipeSelect,normalizeRecipes} from '../src/production/queries.mjs';
import {consumptionPreview,recipePacking} from '../src/production/model.mjs';

assert.equal(recipeSelect,'*,inventory_bom_lines(*),inventory_bom_packaging(*,inventory_bom_packaging_lines(*))');
const input=[{id:'bom',product_part_number:'FG-1',inventory_bom_lines:[{ingredient_id:'raw',quantity_per_unit:2,waste_rate:0}],inventory_bom_packaging:[
 {packaging_type:'returnable',box_name:'Rack',pieces_per_box:10,inventory_bom_packaging_lines:[{ingredient_id:'rack',packaging_type:'returnable',quantity:1,basis:'pallet',waste_rate:0}]},
 {packaging_type:'expendable',box_name:'Carton',pieces_per_box:5,inventory_bom_packaging_lines:[{ingredient_id:'carton',packaging_type:'expendable',quantity:1,basis:'box',waste_rate:0}]}
]}];
const [bom]=normalizeRecipes(input);
assert.equal(bom.inventory_bom_packaging_lines.length,2);
assert.equal(input[0].inventory_bom_packaging_lines,undefined,'normalization must not alter source rows');
const editor=recipePacking(bom);
assert.equal(editor[0].lines[0].ingredient_id,'rack');
assert.equal(editor[1].lines[0].ingredient_id,'carton');
const rows=consumptionPreview({item_id:'fg',machine_quantity:20,scrap_quantity:0,rework_quantity:0,full_boxes:4,pallets:1,packaging_type:'expendable',report_mode:'production'},bom,[{id:'raw',category:'RAW'}],bom.inventory_bom_packaging[1]);
assert.deepEqual(rows.map(r=>[r.ingredient_id,r.quantity]),[['raw',40],['carton',4]]);
assert.deepEqual(normalizeRecipes(null),[]);
const [legacy]=normalizeRecipes([{id:'legacy',inventory_bom_lines:[{ingredient_id:'raw'}]}]);
assert.equal(legacy.inventory_bom_lines.length,1);
assert.deepEqual(legacy.inventory_bom_packaging_lines,[]);
console.log('PASS: nested BOM loading, recipe editor, selected-variant consumption and legacy recipes.');
