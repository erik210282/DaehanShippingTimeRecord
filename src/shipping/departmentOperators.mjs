// Selectable users always come from active department assignments. No global fallback.
export const departmentOperators=(db,department,includeInactive=false)=>db.rpc('department_operators',{p_department:department,p_include_inactive:includeInactive});
