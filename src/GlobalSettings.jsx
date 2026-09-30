import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase/client';
import { departmentKeys } from './GlobalPortal';
import './GlobalPortal.css';

const emptyAssignments = () => ({});

export default function GlobalSettings({ access }) {
  const { t } = useTranslation();
  const managed = access.admin ? departmentKeys : departmentKeys.filter(d => access.memberships.some(m => m.department === d && m.role === 'supervisor'));
  const [people, setPeople] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState(emptyAssignments);
  const [newDraft, setNewDraft] = useState(emptyAssignments);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [users, assigned] = await Promise.all([
      supabase.from('operadores').select('uid,nombre,email,activo').not('uid', 'is', null).order('nombre'),
      supabase.from('global_department_memberships').select('user_id,department,role,active').order('department'),
    ]);
    if (users.error || assigned.error) { setStatus(users.error?.message || assigned.error?.message); return; }
    setPeople(users.data || []); setMemberships(assigned.data || []);
    return assigned.data || [];
  }
  useEffect(() => { refresh(); }, []);

  function selectUser(uid) {
    setSelected(uid); setLink(''); setStatus('');
    setDraft(Object.fromEntries(memberships.filter(m => m.user_id === uid && m.active && managed.includes(m.department)).map(m => [m.department, m.role])));
  }
  function roleChoices(department, uid) {
    const existing = memberships.find(m => m.user_id === uid && m.department === department);
    if (!access.admin && existing?.role === 'supervisor') return ['supervisor'];
    return access.admin ? ['operador', 'lider', 'supervisor'] : ['operador', 'lider'];
  }
  function Choices({ values, onChange, userId = '' }) {
    return <div className="global-department-choices">{managed.map(department => {
      const locked = userId && !access.admin && memberships.some(m => m.user_id === userId && m.department === department && m.role === 'supervisor');
      return <label key={department} className="global-department-choice">
        <input type="checkbox" checked={!!values[department]} disabled={locked} onChange={e => onChange(v => { const next = { ...v }; if (e.target.checked) next[department] = 'operador'; else delete next[department]; return next; })} />
        <span>{t(`global_${department}`)}</span>
        {values[department] && <select value={values[department]} disabled={locked} aria-label={`${t(`global_${department}`)} · ${t('global_role')}`} onChange={e => onChange(v => ({ ...v, [department]: e.target.value }))}>
          {roleChoices(department, userId).map(role => <option key={role} value={role}>{t(`global_role_${role}`)}</option>)}
        </select>}
      </label>;
    })}</div>;
  }

  async function invoke(body) {
    const { data, error } = await supabase.functions.invoke('global-user-admin', { body });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function perform(action) {
    setBusy(true); setStatus(''); setLink('');
    try { await action(); setStatus(t('global_saved')); }
    catch (error) { setStatus(error.message || String(error)); }
    finally { setBusy(false); }
  }

  async function saveAssignments() {
    const before = memberships.filter(m => m.user_id === selected && managed.includes(m.department));
    for (const department of managed) {
      const old = before.find(m => m.department === department);
      const nextRole = draft[department];
      if (nextRole && (!old?.active || old.role !== nextRole)) {
        const { error } = await supabase.from('global_department_memberships').upsert({ user_id: selected, department, role: nextRole, active: true }, { onConflict: 'user_id,department' });
        if (error) throw error;
      } else if (!nextRole && old?.active) {
        const { error } = await supabase.from('global_department_memberships').update({ active: false, updated_at: new Date().toISOString() }).eq('user_id', selected).eq('department', department);
        if (error) throw error;
      }
    }
    await refresh();
    window.dispatchEvent(new Event('global-access-updated'));
  }

  const person = people.find(u => u.uid === selected);
  return <main className="global-page">
    <div className="global-heading"><span>DAEHAN APP</span><h1>{t('global_settings')}</h1></div>
    {status && <p role="status">{status}</p>}
    {link && <div className="global-panel"><strong>{t('global_password_link')}</strong><p>{t('global_link_private')}</p><div className="global-link-output">{link}</div><button className="global-settings-action" onClick={() => navigator.clipboard.writeText(link)}>{t('global_copy_link')}</button></div>}
    <div className="global-settings-grid">
      <section className="global-panel"><h2>{t('global_users')}</h2>
        <div className="global-list">{people.map(u => {
          const assigned = memberships.filter(m => m.user_id === u.uid && m.active && managed.includes(m.department));
          if (!access.admin && !assigned.length) return null;
          return <button type="button" className="global-user-row" aria-selected={selected === u.uid} key={u.uid} onClick={() => selectUser(u.uid)}>
            <span><strong>{u.nombre}</strong><br /><small>{u.email}{!u.activo && ` · ${t('global_inactive_user')}`}</small></span>
            <span className="global-role-tags">{assigned.map(m => <span className="global-role-tag" key={m.department}>{t(`global_${m.department}`)} · {t(`global_role_${m.role}`)}</span>)}</span>
          </button>;
        })}</div>
      </section>
      <section className="global-panel"><h2>{t('global_access')}</h2>
        <label>{t('global_user')}<select value={selected} onChange={e => selectUser(e.target.value)}><option value="">—</option>{people.map(u => <option key={u.uid} value={u.uid}>{u.nombre}</option>)}</select></label>
        {person && <><p>{person.nombre} · {person.email}</p><Choices values={draft} onChange={setDraft} userId={selected} />
          <div className="global-access-actions">
            <button className="global-settings-action" disabled={busy || !person.activo} onClick={() => perform(saveAssignments)}>{t('global_save_access')}</button>
            {person.activo && <button className="global-settings-action global-action-secondary" disabled={busy} onClick={() => perform(async () => { const result = await invoke({ action: 'link', user_id: selected }); setLink(result.link); })}>{t('global_generate_link')}</button>}
          </div>
          {access.admin && selected !== access.userId && <section className="global-account-actions" aria-label={t('global_account_actions')}>
            <h3>{t('global_account_actions')}</h3>
            <div className="global-user-actions">
              <button className="global-settings-action global-action-secondary" disabled={busy} onClick={() => perform(async () => { await invoke({ action: person.activo ? 'deactivate' : 'reactivate', user_id: selected }); await refresh(); })}>{t(person.activo ? 'global_disable_user' : 'global_enable_user')}</button>
              <button className="global-settings-action global-action-danger" disabled={busy} onClick={() => { if (window.confirm(t('global_confirm_delete'))) perform(async () => { await invoke({ action: 'delete', user_id: selected }); setSelected(''); setDraft({}); await refresh(); }); }}>{t('global_delete_unused')}</button>
            </div>
          </section>}
        </>}
      </section>
      <section className="global-panel"><h2>{t('global_create_user')}</h2>
        <form onSubmit={e => { e.preventDefault(); perform(async () => {
          const assignments = Object.entries(newDraft).map(([department, role]) => ({ department, role }));
          if (!assignments.length) throw new Error(t('global_choose_department'));
          const result = await invoke({ action: 'create', name: name.trim(), email: email.trim(), assignments });
          setName(''); setEmail(''); setNewDraft({});
          const updated = await refresh();
          setSelected(result.user_id);
          setDraft(Object.fromEntries((updated || []).filter(m => m.user_id === result.user_id && m.active && managed.includes(m.department)).map(m => [m.department, m.role])));
          setLink(result.link);
        }); }}>
          <label>{t('global_name')}<input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>{t('email')}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <strong>{t('global_access')}</strong><Choices values={newDraft} onChange={setNewDraft} />
          <button disabled={busy}>{t('global_create_and_link')}</button>
        </form>
      </section>
    </div>
  </main>;
}
