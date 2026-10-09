import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase/client';
import { localGreeting } from './GlobalAnnouncements';
import './GlobalPortal.css';

import { departmentKeys, visibleDepartments } from './access';
export { departmentKeys } from './access';

export function useGlobalAccess() {
  const [state, setState] = useState({ loading: true, memberships: [], admin: false, supervisor: false, name: '', userId: '', error: '' });
  useEffect(() => {
    let live = true;
    let request = 0;
    const load = async () => {
      const ownRequest = ++request;
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!live) return;
      if (authError || !user) { setState({ loading: false, memberships: [], admin: false, supervisor: false, name: '', userId: '', error: authError?.message || 'Sesión expirada' }); return; }
      const [person, access, admin] = await Promise.all([
        supabase.from('operadores').select('nombre,activo').eq('uid', user.id).maybeSingle(),
        supabase.from('global_department_memberships').select('department,role').eq('user_id', user.id).eq('active', true),
        supabase.from('global_system_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!live || ownRequest !== request) return;
      const error = person.error || access.error || admin.error;
      setState({ loading: false, memberships: access.data || [], admin: !!admin.data,
        supervisor: (access.data || []).some(m => m.role === 'supervisor'),
        name: person.data?.nombre || '', userId: user.id,
        error: error?.message || (person.data?.activo ? '' : 'Cuenta inactiva') });
    };
    load();
    const focus = () => load();
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', focus);
    window.addEventListener('global-access-updated', focus);
    document.addEventListener('visibilitychange', visible);
    const channel = supabase.channel('global-access-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_department_memberships' }, load).subscribe();
    return () => { live = false; window.removeEventListener('focus', focus); window.removeEventListener('global-access-updated', focus); document.removeEventListener('visibilitychange', visible); supabase.removeChannel(channel); };
  }, []);
  return state;
}

export function GlobalHome({ access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return <main className="global-page">
    <div className="global-heading"><span>DAEHAN APP · {t('global_home')}</span><h1>{localGreeting(t)}, {access.name}</h1></div>
    <div className="global-cards">
      {visibleDepartments(access.memberships, access.admin).map(key =>
        <button key={key} className="global-card" onClick={() => navigate(key === 'shipping' ? '/tareas-pendientes' : key === 'inventory' ? '/inventarios' : `/departamento/${key}`)}>
          <span>{key[0].toUpperCase()}</span><strong>{t(`global_${key}`)}</strong><small>↗</small>
        </button>
      )}
      <button className="global-card" onClick={() => navigate('/catalogos')}><span>C</span><strong>{t('catalogs')}</strong><small>›</small></button>
      <button className="global-card" onClick={() => navigate('/announcements')}><span>✉</span><strong>{t('global_announcements')}</strong><small>↗</small></button>
      {(access.admin || access.supervisor) && <button className="global-card" onClick={() => navigate('/global-settings')}><span>⚙</span><strong>{t('global_settings')}</strong><small>↗</small></button>}
    </div>
  </main>;
}

export function DepartmentLanding({ name, access }) {
  const { t } = useTranslation();
  const navigate=useNavigate();
  if (!departmentKeys.includes(name) || (!access.admin && !access.memberships.some(m => m.department === name))) return <Navigate to="/inicio" replace />;
  return <main className="global-page">
    <div className="global-heading"><span>DAEHAN APP · {t('global_department')}</span><h1>{t(`global_${name}`)}</h1></div>
    <section className="global-panel">{t('global_pending')}</section>
  </main>;
}
