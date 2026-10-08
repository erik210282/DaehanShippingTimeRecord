// Packaging lines belong to a packaging variant, which belongs to a BOM.
export const recipeSelect='*,inventory_bom_lines(*),inventory_bom_packaging(*,inventory_bom_packaging_lines(*))';
export function normalizeRecipes(rows) {
 return (rows||[]).map(row=>{
  const packing=row.inventory_bom_packaging||[];
  return {...row,inventory_bom_lines:row.inventory_bom_lines||[],inventory_bom_packaging:packing,inventory_bom_packaging_lines:packing.flatMap(profile=>profile.inventory_bom_packaging_lines||[])};
 });
}
