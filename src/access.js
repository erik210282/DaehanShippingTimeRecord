export const departmentKeys = ['shipping', 'production', 'quality', 'receiving', 'inventory'];
export function visibleDepartments(memberships, admin = false) {
  return departmentKeys.filter(key => admin || memberships.some(item => item.department === key && item.active !== false));
}
