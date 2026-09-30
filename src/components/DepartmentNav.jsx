import React from 'react';

export default function DepartmentNav({ items, value, onChange, label }) {
  return <nav className="department-nav" aria-label={label}>
    {items.map(item => <button type="button" key={item.key} aria-current={value === item.key ? 'page' : undefined} onClick={() => onChange(item.key)}>{item.label}{item.badge > 0 && <span className="department-nav-badge">{item.badge}</span>}</button>)}
  </nav>;
}
