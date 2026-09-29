import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase/client';
import { localGreeting } from './GlobalAnnouncements';
import './GlobalPortal.css';

export const departmentKeys = ['shipping', 'production', 'quality', 'receiving', 'inventory'];

export function useGlobalAccess() {
  const [state, setState] = useState({ loading: true, memberships: [], admin: false, supervisor: false, name: '', userId: '', error: '' });
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!live) return;
      if (authError || !user) { setState({ loading: false, memberships: [], admin: false, supervisor: false, name: '', userId: '', error: authError?.message || 'Sesión expirada' }); return; }
      const [person, access, admin] = await Promise.all([
        supabase.from('operadores').select('nombre,activo').eq('uid', user.id).maybeSingle(),
        supabase.from('global_department_memberships').select('department,role').eq('user_id', user.id).eq('active', true),
        supabase.from('global_system_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!live) return;
      const error = person.error || access.error || admin.error;
      setState({ loading: false, memberships: access.data || [], admin: !!admin.data,
        supervisor: (access.data || []).some(m => m.role === 'supervisor'),
        name: person.data?.nombre || '', userId: user.id,
        error: error?.message || (person.data?.activo ? '' : 'Cuenta inactiva') });
    })();
    return () => { live = false; };
  }, []);
  return state;
}

export function GlobalHome({ access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return <main className="global-page">
    <div className="global-heading"><span>DAEHAN APP · {t('global_home')}</span><h1>{localGreeting(t)}, {access.name}</h1></div>
    <div className="global-cards">
      {departmentKeys.filter(key => access.admin || access.memberships.some(item => item.department === key)).map(key =>
        <button key={key} className="global-card" onClick={() => navigate(key === 'shipping' ? '/tareas-pendientes' : key === 'inventory' ? '/inventarios' : `/departamento/${key}`)}>
          <span>{key[0].toUpperCase()}</span><strong>{t(`global_${key}`)}</strong><small>↗</small>
        </button>
      )}
      <button className="global-card" onClick={() => navigate('/announcements')}><span>✉</span><strong>{t('global_announcements')}</strong><small>↗</small></button>
      {(access.admin || access.supervisor) && <button className="global-card" onClick={() => navigate('/global-settings')}><span>⚙</span><strong>{t('global_settings')}</strong><small>↗</small></button>}
    </div>
  </main>;
}

export function DepartmentLanding({ name, access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!departmentKeys.includes(name) || (!access.admin && !access.memberships.some(m => m.department === name))) return <Navigate to="/inicio" replace />;
  return <main className="global-page">{(access.admin || access.supervisor) && <button className="global-back" onClick={() => navigate('/inicio')}>← {t('global_home')}</button>}
    <div className="global-heading"><span>DAEHAN APP · {t('global_department')}</span><h1>{t(`global_${name}`)}</h1></div>
    <section className="global-panel">{t('global_pending')}</section>
  </main>;
}
