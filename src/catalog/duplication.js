export const catalogIdentifier = (tab, kind) => kind ? 'code' : ({
 productos:'part_number', pos:'po', shipper:'shipper_name', actividades:'nombre',
 stations:'code', bom:'product_part_number',
})[tab] || 'nombre';
export const normalizeIdentifier = value => String(value ?? '').trim().toUpperCase();
export function duplicateCatalogRow(row, key) {
 const copy = JSON.parse(JSON.stringify(row));
 for (const field of ['id','inventory_id','producto_id','created_at','updated_at','created_by','builtin','archived','is_system_stage','is_default']) delete copy[field];
 copy[key] = '';
 return copy;
}
export const hasDuplicateIdentifier = (rows, key, value) =>
 rows.some(row => normalizeIdentifier(row[key]) === normalizeIdentifier(value));
