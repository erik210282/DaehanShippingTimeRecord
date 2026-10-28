export const departmentKeys = ['shipping', 'production', 'quality', 'receiving', 'inventory'];
export function visibleDepartments(memberships, admin = false) {
  return departmentKeys.filter(key => admin || memberships.some(item => item.department === key && item.active !== false));
}

// Catalogs and Settings are assignable modules, separate from operational departments.
export const accessKeys=[...departmentKeys,'catalogs','settings'];
export function moduleAllowed(memberships=[],admin=false,module,manage=false){
 return admin||memberships.some(m=>m.active!==false&&m.department===module&&(!manage||['lider','supervisor'].includes(m.role)));
}
