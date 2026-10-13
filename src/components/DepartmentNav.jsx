import {useRoleAccess} from '../RoleAccess';
import React from 'react';

export default function DepartmentNav({ items, value, onChange, label,department }) {
  const access=useRoleAccess();
  const visible=items.filter(item=>!department||!access||access.can(department,item.key));
  React.useEffect(()=>{if(visible.length&&!visible.some(item=>item.key===value))onChange(visible[0].key);},[value,visible.map(item=>item.key).join('|'),onChange]);
  return <nav className="department-nav" aria-label={label}>
    {visible.map(item => <button type="button" key={item.key} aria-current={value === item.key ? 'page' : undefined} onClick={() => onChange(item.key)}>{item.label}{item.badge > 0 && <span className="department-nav-badge">{item.badge}</span>}</button>)}
  </nav>;
}
