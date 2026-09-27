import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { configured, supabase } from './client';
import { departments } from './translations';

const order = ['home', ...departments, 'settings'];

function LanguagePicker() {
  const { i18n } = useTranslation();
  return <select aria-label="Language" value={i18n.language} onChange={(event) => {
    i18n.changeLanguage(event.target.value);
    try { localStorage.setItem('lang', event.target.value); } catch { /* optional */ }
  }}>
    <option value="es">🇲🇽 Español</option>
    <option value="en">🇺🇸 English</option>
    <option value="ko">🇰🇷 한국어</option>
  </select>;
}

function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    setBusy(false);
  }
  return <main className="login-page">
    <div className="login-card">
      <div className="login-head"><div className="brand-symbol">D</div><LanguagePicker /></div>
      <p className="eyebrow">DAEHAN</p><h1>{t('app')}</h1>
      <form onSubmit={submit}>
        <label>{t('user')}<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>{t('password')}<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? t('loading') : t('login')}</button>
      </form>
    </div>
  </main>;
}

function Home({ profile, access, isAdmin }) {
  const { t } = useTranslation();
  return <div className="page">
    <p className="eyebrow">DAEHAN · {t('home')}</p>
    <h1>{t('welcome')}, {profile.nombre}</h1>
    <p className="muted">{access.length ? t('access') : t('noAccess')}</p>
    <div className="cards">
      {order.slice(1).map((name) => {
        const allowed = name === 'settings' ? isAdmin : access.some(item => item.department === name);
        return allowed ? <Link className="department-card" key={name} to={`/${name}`}>
          <span className="card-mark">{name.slice(0, 1).toUpperCase()}</span>
          <strong>{t(name)}</strong><span className="arrow">↗</span>
        </Link> : <div className="department-card locked" key={name} aria-disabled="true">
          <span className="card-mark">{name.slice(0, 1).toUpperCase()}</span><strong>{t(name)}</strong><span className="lock">○</span>
        </div>;
      })}
    </div>
  </div>;
}

function DepartmentPage({ name }) {
  const { t } = useTranslation();
  return <div className="page">
    <Link className="back" to="/">← {t('home')}</Link>
    <p className="eyebrow">DAEHAN · {t('departments')}</p><h1>{t(name)}</h1>
    <div className="panel"><span className="card-mark big">{name[0].toUpperCase()}</span>
      <p>{t(name === 'shipping' ? 'shippingPending' : 'pending')}</p>
      {name === 'inventory' && <p className="muted">{t('inventoryNote')}</p>}
    </div>
  </div>;
}

function Settings() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [userId, setUserId] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('operador');
  const [audience, setAudience] = useState('all');
  const [recipient, setRecipient] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [people, access, news] = await Promise.all([
      supabase.from('operadores').select('uid,nombre,activo').not('uid', 'is', null).order('nombre'),
      supabase.from('global_department_memberships').select('user_id,department,role,active').order('department'),
      supabase.from('global_announcements').select('id,title,audience,active,created_at').order('created_at', { ascending: false }).limit(30),
    ]);
    const firstError = people.error || access.error || news.error;
    if (firstError) { setStatus(firstError.message); return; }
    setUsers(people.data || []); setMemberships(access.data || []); setAnnouncements(news.data || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function assign(event) {
    event.preventDefault(); setBusy(true); setStatus('');
    const { error } = await supabase.from('global_department_memberships').upsert(
      { user_id: userId, department, role, active: true }, { onConflict: 'user_id,department' }
    );
    setStatus(error ? error.message : t('assigned'));
    if (!error) await refresh();
    setBusy(false);
  }
  async function publish(event) {
    event.preventDefault(); setBusy(true); setStatus('');
    const { error } = await supabase.from('global_announcements').insert({
      title: title.trim(), body: body.trim(), audience,
      target_user_id: audience === 'user' ? recipient : null,
    });
    setStatus(error ? error.message : t('published'));
    if (!error) { setTitle(''); setBody(''); await refresh(); }
    setBusy(false);
  }
  async function deactivate(id) {
    setBusy(true); setStatus('');
    const { error } = await supabase.from('global_announcements').update({ active: false }).eq('id', id);
    setStatus(error ? error.message : t('saved'));
    if (!error) await refresh();
    setBusy(false);
  }
  async function toggleMembership(member) {
    setBusy(true); setStatus('');
    const { error } = await supabase.from('global_department_memberships')
      .update({ active: !member.active, updated_at: new Date().toISOString() })
      .eq('user_id', member.user_id).eq('department', member.department);
    setStatus(error ? error.message : t('saved'));
    if (!error) await refresh();
    setBusy(false);
  }
  return <div className="page">
    <Link className="back" to="/">← {t('home')}</Link>
    <p className="eyebrow">DAEHAN · {t('settings')}</p><h1>{t('settings')}</h1>
    <p className="muted">{t('adminSetup')}</p>
    {status && <p className="notice" role="status">{status}</p>}
    <div className="settings-grid">
      <section className="panel"><h2>{t('accessAdmin')}</h2>
        <form onSubmit={assign}>
          <label>{t('user')}<select required value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">{t('chooseUser')}</option>
            {users.filter(user => user.activo).map(user => <option key={user.uid} value={user.uid}>{user.nombre}</option>)}
          </select></label>
          <label>{t('departments')}<select required value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="">{t('chooseDepartment')}</option>
            {departments.map(d => <option key={d} value={d}>{t(d)}</option>)}
          </select></label>
          <label>{t('role')}<select value={role} onChange={e => setRole(e.target.value)}>
            {['operador', 'lider', 'supervisor'].map(r => <option key={r} value={r}>{t({ operador: 'operator', lider: 'leader', supervisor: 'supervisor' }[r])}</option>)}
          </select></label>
          <button className="primary" disabled={busy}>{t('assign')}</button>
        </form>
        {!users.length && <p className="muted">{t('noUsers')}</p>}
        <div className="list">{memberships.map(m => <div key={`${m.user_id}-${m.department}`}>
          <strong>{users.find(u => u.uid === m.user_id)?.nombre || m.user_id}</strong>
          <span>{t(m.department)} · {m.role}{m.active ? '' : ` · ${t('inactiveStatus')}`}</span>
          <button className="text-button" disabled={busy} onClick={() => toggleMembership(m)}>{t(m.active ? 'disable' : 'enable')}</button>
        </div>)}</div>
      </section>
      <section className="panel"><h2>{t('announcementAdmin')}</h2>
        <form onSubmit={publish}>
          <label>{t('audience')}<select value={audience} onChange={e => setAudience(e.target.value)}>
            <option value="all">{t('general')}</option><option value="user">{t('individual')}</option>
          </select></label>
          {audience === 'user' && <label>{t('audience')}<select required value={recipient} onChange={e => setRecipient(e.target.value)}>
            <option value="">{t('chooseUser')}</option>
            {users.filter(user => user.activo).map(user => <option key={user.uid} value={user.uid}>{user.nombre}</option>)}
          </select></label>}
          <label>{t('title')}<input required maxLength={140} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>{t('message')}<textarea required rows={4} value={body} onChange={e => setBody(e.target.value)} /></label>
          <button className="primary" disabled={busy}>{t('publish')}</button>
        </form>
        <div className="list">{announcements.map(a => <div key={a.id}>
          <strong>{a.title}</strong><span>{t(a.audience === 'all' ? 'general' : 'individual')}</span>
          {a.active && <button className="text-button" disabled={busy} onClick={() => deactivate(a.id)}>{t('disable')}</button>}
        </div>)}</div>
      </section>
    </div>
  </div>;
}

function Shell({ session }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [state, setState] = useState({ loading: true, profile: null, access: [], isAdmin: false, error: '' });
  useEffect(() => {
    let alive = true;
    async function load() {
      const [person, memberships, admin] = await Promise.all([
        supabase.from('operadores').select('nombre,activo').eq('uid', session.user.id).maybeSingle(),
        supabase.from('global_department_memberships').select('department,role').eq('user_id', session.user.id).eq('active', true),
        supabase.from('global_system_admins').select('user_id').eq('user_id', session.user.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (person.error || memberships.error || admin.error) {
        setState(s => ({ ...s, loading: false, error: (person.error || memberships.error || admin.error).message }));
      } else if (!person.data?.activo) {
        setState(s => ({ ...s, loading: false, error: t('inactive') }));
        await supabase.auth.signOut();
      } else {
        setState({ loading: false, profile: person.data, access: memberships.data || [], isAdmin: Boolean(admin.data), error: '' });
      }
    }
    load();
    return () => { alive = false; };
  }, [session.user.id, t]);
  if (state.loading) return <div className="center-message">{t('loading')}</div>;
  if (state.error) return <div className="center-message error">{state.error} <button onClick={() => supabase.auth.signOut()}>{t('logout')}</button></div>;
  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-symbol">D</span><span>DAEHAN <small>{t('app')}</small></span></Link>
      <nav aria-label={t('departments')}>
        <Link className={location.pathname === '/' ? 'current' : ''} to="/">{t('home')}</Link>
        {departments.filter(d => state.access.some(a => a.department === d)).map(d => <Link className={location.pathname === `/${d}` ? 'current' : ''} key={d} to={`/${d}`}>{t(d)}</Link>)}
        {state.isAdmin && <Link className={location.pathname === '/settings' ? 'current' : ''} to="/settings">{t('settings')}</Link>}
      </nav>
      <div className="tools"><LanguagePicker /><button onClick={() => supabase.auth.signOut()}>{t('logout')}</button></div>
    </header>
    <Routes>
      <Route path="/" element={<Home profile={state.profile} access={state.access} isAdmin={state.isAdmin} />} />
      {departments.map(d => <Route key={d} path={`/${d}`} element={state.access.some(a => a.department === d) ? <DepartmentPage name={d} /> : <Navigate to="/" replace />} />)}
      <Route path="/settings" element={state.isAdmin ? <Settings /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </div>;
}

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(configured);
  useEffect(() => {
    if (!configured) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setSession(data.session); setLoading(false); }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  if (!configured) return <div className="center-message">{t('missingConfig')}</div>;
  if (loading) return <div className="center-message">{t('loading')}</div>;
  return session ? <Shell key={session.user.id} session={session} /> : <Login />;
}
