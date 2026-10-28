import {directoryPeople} from '../userDirectory.mjs';
// Selectable users come from active department assignments; the reserved Admin is never selectable.
export async function departmentOperators(db, department, includeInactive = false) {
  const result = await db.rpc('department_operators', {p_department: department, p_include_inactive: includeInactive});
  return result.error || !Array.isArray(result.data) ? result : {...result, data: directoryPeople(result.data)};
}
