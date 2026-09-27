import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase/client';
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
    <div className="global-heading"><span>DAEHAN · {t('global_home')}</span><h1>{t('global_welcome')}, {access.name}</h1></div>
    <div className="global-cards">
      {departmentKeys.filter(key => access.admin || access.memberships.some(item => item.department === key)).map(key =>
        <button key={key} className="global-card" onClick={() => navigate(key === 'shipping' ? '/tareas-pendientes' : `/departamento/${key}`)}>
          <span>{key[0].toUpperCase()}</span><strong>{t(`global_${key}`)}</strong><small>↗</small>
        </button>
      )}
      {(access.admin || access.supervisor) && <button className="global-card" onClick={() => navigate('/global-settings')}><span>⚙</span><strong>{t('global_settings')}</strong><small>↗</small></button>}
    </div>
  </main>;
}

export function DepartmentLanding({ name, access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!departmentKeys.includes(name) || (!access.admin && !access.memberships.some(m => m.department === name))) return <Navigate to="/inicio" replace />;
  return <main className="global-page">{(access.admin || access.supervisor) && <button className="global-back" onClick={() => navigate('/inicio')}>← {t('global_home')}</button>}
    <div className="global-heading"><span>DAEHAN · {t('global_department')}</span><h1>{t(`global_${name}`)}</h1></div>
    <section className="global-panel">{t('global_pending')}</section>
  </main>;
}

export function GlobalSettings({ access }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [userId, setUserId] = useState('');
  const managedDepartments = access.admin ? departmentKeys : departmentKeys.filter(d => access.memberships.some(m => m.department === d && m.role === 'supervisor'));
  const [department, setDepartment] = useState(managedDepartments[0] || '');
  const [role, setRole] = useState('operador');
  const [audience, setAudience] = useState('all');
  const [recipient, setRecipient] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [people, assigned, news] = await Promise.all([
      supabase.from('operadores').select('uid,nombre,activo').not('uid', 'is', null).order('nombre'),
      supabase.from('global_department_memberships').select('user_id,department,role,active').order('department'),
      access.admin ? supabase.from('global_announcements').select('id,title,audience,active').order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = people.error || assigned.error || news.error;
    if (error) { setStatus(error.message); return; }
    setUsers(people.data || []); setMemberships(assigned.data || []); setAnnouncements(news.data || []);
  }
  useEffect(() => { refresh(); }, []);
  async function perform(action) {
    setBusy(true); setStatus('');
    const { error } = await action();
    setStatus(error?.message || t('global_saved'));
    if (!error) await refresh();
    setBusy(false);
  }
  return <main className="global-page"><button className="global-back" onClick={() => navigate('/inicio')}>← {t('global_home')}</button>
    <div className="global-heading"><span>DAEHAN</span><h1>{t('global_settings')}</h1></div>
    {status && <p role="status">{status}</p>}
    <div className="global-settings-grid">
      <section className="global-panel"><h2>{t('global_access')}</h2>
        <form onSubmit={event => { event.preventDefault(); perform(() => supabase.from('global_department_memberships').upsert({ user_id: userId, department, role, active: true }, { onConflict: 'user_id,department' })); }}>
          <label>{t('global_user')}<select required value={userId} onChange={e => setUserId(e.target.value)}><option value="">—</option>{users.filter(u => u.activo).map(u => <option key={u.uid} value={u.uid}>{u.nombre}</option>)}</select></label>
          <label>{t('global_department')}<select value={department} onChange={e => setDepartment(e.target.value)}>{managedDepartments.map(d => <option key={d} value={d}>{t(`global_${d}`)}</option>)}</select></label>
          <label>{t('global_role')}<select value={role} onChange={e => setRole(e.target.value)}>{(access.admin ? ['operador','lider','supervisor'] : ['operador','lider']).map(r => <option key={r} value={r}>{t(`global_role_${r}`)}</option>)}</select></label>
          <button disabled={busy}>{t('global_assign')}</button>
        </form>
        <div className="global-list">{memberships.map(m => <div key={`${m.user_id}-${m.department}`}><span>{users.find(u => u.uid === m.user_id)?.nombre || m.user_id} · {t(`global_${m.department}`)} · {t(`global_role_${m.role}`)}</span>{(access.admin || (m.user_id !== access.userId && m.role !== 'supervisor')) && <button disabled={busy} onClick={() => perform(() => supabase.from('global_department_memberships').update({ active: !m.active, updated_at: new Date().toISOString() }).eq('user_id', m.user_id).eq('department', m.department))}>{t(m.active ? 'global_disable' : 'global_enable')}</button>}</div>)}</div>
      </section>
      {access.admin && <section className="global-panel"><h2>{t('global_announcements')}</h2>
        <form onSubmit={event => { event.preventDefault(); perform(async () => { const result = await supabase.from('global_announcements').insert({ title: title.trim(), body: body.trim(), audience, target_user_id: audience === 'user' ? recipient : null }); if (!result.error) { setTitle(''); setBody(''); } return result; }); }}>
          <label>{t('global_audience')}<select value={audience} onChange={e => setAudience(e.target.value)}><option value="all">{t('global_everyone')}</option><option value="user">{t('global_individual')}</option></select></label>
          {audience === 'user' && <label>{t('global_user')}<select required value={recipient} onChange={e => setRecipient(e.target.value)}><option value="">—</option>{users.filter(u => u.activo).map(u => <option key={u.uid} value={u.uid}>{u.nombre}</option>)}</select></label>}
          <label>{t('global_title')}<input required maxLength={140} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>{t('global_message')}<textarea required rows={4} value={body} onChange={e => setBody(e.target.value)} /></label>
          <button disabled={busy}>{t('global_publish')}</button>
        </form>
        <div className="global-list">{announcements.map(a => <div key={a.id}><span>{a.title} · {t(a.audience === 'all' ? 'global_everyone' : 'global_individual')}</span>{a.active && <button disabled={busy} onClick={() => perform(() => supabase.from('global_announcements').update({ active: false }).eq('id', a.id))}>{t('global_disable')}</button>}</div>)}</div>
      </section>}
    </div>
  </main>;
}
