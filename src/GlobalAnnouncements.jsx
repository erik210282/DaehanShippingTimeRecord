import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase/client';

export function translatedAnnouncement(item, field, language) {
  return item?.[`${field}_translations`]?.[language?.slice(0, 2)] || item?.[field] || '';
}

export function localGreeting(t) {
  const hour = new Date().getHours();
  return t(hour < 12 ? 'global_good_morning' : hour < 19 ? 'global_good_afternoon' : 'global_good_evening');
}

export function useAnnouncementGate(userId) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [seenVersion, setSeenVersion] = useState(0);
  const [gate, setGate] = useState(false);
  const [notice, setNotice] = useState(false);
  const seen = useRef(new Set());
  const started = useRef(false);
  const gateRef = useRef(false);
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: failure } = await supabase.from('global_announcements')
      .select('id,title,body,title_translations,body_translations,audience,target_user_id,starts_at,ends_at')
      .eq('active', true).order('created_at', { ascending: true });
    if (failure) { setError(failure.message); setReady(true); return; }
    const now = Date.now();
    const available = (data || []).filter(a => (a.audience === 'all' || a.target_user_id === userId)
      && new Date(a.starts_at).getTime() <= now && (!a.ends_at || new Date(a.ends_at).getTime() > now));
    setItems(available); setError(''); setReady(true);
    const pending = available.some(a => !seen.current.has(a.id));
    if (!started.current) {
      started.current = true;
      gateRef.current = pending;
      setGate(pending);
    } else if (pending && !gateRef.current) setNotice(true);
    else if (!pending && gateRef.current) { gateRef.current = false; setGate(false); }
  }, [userId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`global-announcements-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_announcements' }, load).subscribe();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(load, 60000);
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onFocus); window.clearInterval(timer); };
  }, [load, userId]);

  const pending = items.filter(a => !seen.current.has(a.id));
  async function acknowledge() {
    const item = pending[0];
    if (!item) return true;
    const { error: failure } = await supabase.from('global_announcement_receipts')
      .insert({ announcement_id: item.id, user_id: userId });
    if (failure && failure.code !== '23505') { setError(failure.message); return false; }
    seen.current.add(item.id);
    setSeenVersion(v => v + 1);
    if (pending.length === 1) { gateRef.current = false; setGate(false); setNotice(false); }
    return pending.length === 1;
  }
  function open() { gateRef.current = true; setGate(true); setNotice(false); }
  return { items, pending, ready, error, notice, gate, acknowledge, open, load, seenVersion };
}

export function AnnouncementNotice({ onOpen }) {
  const { t } = useTranslation();
  return <div className="global-announcement-notice" role="alertdialog" aria-label={t('global_new_announcement')}>
    <strong>{t('global_new_announcement')}</strong>
    <button onClick={onOpen}>{t('global_view_announcement')}</button>
  </div>;
}

export function GlobalAnnouncements({ access, announcements, onContinue, onBack }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [audience, setAudience] = useState('all');
  const [recipient, setRecipient] = useState('');
  const [translations, setTranslations] = useState({ es: { title: '', body: '' }, en: { title: '', body: '' }, ko: { title: '', body: '' } });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminItems, setAdminItems] = useState([]);
  const loadAdminItems = useCallback(async () => {
    if (!access.admin) return;
    const { data, error } = await supabase.from('global_announcements')
      .select('id,title,title_translations,audience,active,created_at').order('created_at', { ascending: false });
    if (error) setStatus(error.message);
    else setAdminItems(data || []);
  }, [access.admin]);
  useEffect(() => {
    if (access.admin) supabase.from('operadores').select('uid,nombre,activo').not('uid', 'is', null).order('nombre')
      .then(({ data }) => setUsers(data || []));
  }, [access.admin]);
  useEffect(() => { loadAdminItems(); }, [loadAdminItems]);

  async function publish(event) {
    event.preventDefault(); setBusy(true); setStatus('');
    const title = translations.es.title.trim();
    const body = translations.es.body.trim();
    const title_translations = Object.fromEntries(Object.entries(translations).filter(([, value]) => value.title.trim()).map(([lang, value]) => [lang, value.title.trim()]));
    const body_translations = Object.fromEntries(Object.entries(translations).filter(([, value]) => value.body.trim()).map(([lang, value]) => [lang, value.body.trim()]));
    const { error } = await supabase.from('global_announcements').insert({ title, body, title_translations, body_translations, audience,
      target_user_id: audience === 'user' ? recipient : null });
    setStatus(error?.message || t('global_saved'));
    if (!error) {
      setTranslations({ es: { title: '', body: '' }, en: { title: '', body: '' }, ko: { title: '', body: '' } });
      announcements.load();
      loadAdminItems();
    }
    setBusy(false);
  }
  const current = announcements.pending[0];
  return <main className="global-page">
    <div className="global-heading"><span>DAEHAN APP · {t('global_announcements')}</span><h1>{localGreeting(t)}, {access.name}</h1></div>
    {announcements.gate && current ? <section className="global-panel global-announcement-message" aria-live="polite">
      <span className="global-kicker">{t('global_announcement')} · {t(current.audience === 'all' ? 'global_everyone' : 'global_individual')}</span>
      <h2>{translatedAnnouncement(current, 'title', i18n.language)}</h2>
      <p>{translatedAnnouncement(current, 'body', i18n.language)}</p>
      <small>{t('global_progress', { current: announcements.items.length - announcements.pending.length + 1, total: announcements.items.length })}</small>
      <button disabled={busy} onClick={async () => { setBusy(true); const done = await onContinue(); if (done) onBack(); setBusy(false); }}>{t('global_continue')}</button>
    </section> : <>
      <button className="global-back" onClick={() => navigate('/inicio')}>← {t('global_back')}</button>
      <section className="global-panel"><h2>{t('global_announcements')}</h2>
        {announcements.items.length ? announcements.items.map(a => <article key={a.id} className="global-announcement-row"><strong>{translatedAnnouncement(a, 'title', i18n.language)}</strong><small>{t(a.audience === 'all' ? 'global_everyone' : 'global_individual')}</small><p>{translatedAnnouncement(a, 'body', i18n.language)}</p></article>) : <p>{t('global_no_announcements')}</p>}
      </section>
      {access.admin && <section className="global-panel global-announcement-editor"><h2>{t('global_publish')}</h2>
        <form onSubmit={publish}>
          <label>{t('global_audience')}<select value={audience} onChange={e => setAudience(e.target.value)}><option value="all">{t('global_everyone')}</option><option value="user">{t('global_individual')}</option></select></label>
          {audience === 'user' && <label>{t('global_user')}<select required value={recipient} onChange={e => setRecipient(e.target.value)}><option value="">—</option>{users.filter(u => u.activo).map(u => <option key={u.uid} value={u.uid}>{u.nombre}</option>)}</select></label>}
          {['es', 'en', 'ko'].map(lang => <fieldset key={lang}><legend>{lang.toUpperCase()}</legend>
            <label>{t('global_title')}<input required={lang === 'es'} maxLength={140} value={translations[lang].title} onChange={e => setTranslations(v => ({ ...v, [lang]: { ...v[lang], title: e.target.value } }))} /></label>
            <label>{t('global_message')}<textarea required={lang === 'es'} rows={3} value={translations[lang].body} onChange={e => setTranslations(v => ({ ...v, [lang]: { ...v[lang], body: e.target.value } }))} /></label>
          </fieldset>)}
          <button disabled={busy}>{t('global_publish')}</button>
        </form>
        <p>{t('global_translation_hint')}</p>
      </section>}
      {access.admin && <section className="global-panel"><h2>{t('global_manage_announcements')}</h2>
        {adminItems.map(item => <div className="global-announcement-admin-row" key={item.id}>
          <span>{translatedAnnouncement(item, 'title', i18n.language)} · {t(item.audience === 'all' ? 'global_everyone' : 'global_individual')}</span>
          <button disabled={busy} onClick={async () => {
            setBusy(true); setStatus('');
            const { error } = await supabase.from('global_announcements').update({ active: !item.active }).eq('id', item.id);
            if (error) setStatus(error.message);
            else { await Promise.all([announcements.load(), loadAdminItems()]); setStatus(t('global_saved')); }
            setBusy(false);
          }}>{t(item.active ? 'global_disable' : 'global_enable')}</button>
        </div>)}
      </section>}
    </>}
    {(status || announcements.error) && <p role="status">{status || announcements.error}</p>}
  </main>;
}
