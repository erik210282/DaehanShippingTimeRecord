import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageBar from './components/LanguageBar';
import { supabase } from './supabase/client';
import './GlobalPortal.css';

export default function SetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    const token_hash = new URLSearchParams(window.location.hash.slice(1)).get('token_hash');
    window.history.replaceState({}, '', '/set-password');
    if (!token_hash) { setError(t('global_link_invalid')); return; }
    supabase.auth.verifyOtp({ token_hash, type: 'recovery' }).then(({ error: failure }) => {
      if (!live) return;
      if (failure) setError(failure.message);
      else setReady(true);
    });
    return () => { live = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    if (password !== confirm) { setError(t('global_password_mismatch')); return; }
    setBusy(true); setError('');
    const { error: failure } = await supabase.auth.updateUser({ password });
    if (failure) setError(failure.message);
    else { setDone(true); await supabase.auth.signOut({ scope: 'local' }); }
    setBusy(false);
  }
  return <main className="global-page"><div style={{ display: 'flex', justifyContent: 'flex-end' }}><LanguageBar /></div>
    <div className="global-heading"><span>DAEHAN APP</span><h1>{t('global_set_password')}</h1></div>
    <section className="global-panel" style={{ maxWidth: 500 }}>
      {error && <p role="alert">{error}</p>}
      {done ? <><p>{t('global_password_ready')}</p><button className="global-settings-action" onClick={() => navigate('/')}>{t('global_sign_in')}</button></> : ready ? <form onSubmit={save}>
        <label>{t('global_new_password')}<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>{t('global_confirm_password')}<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        <button disabled={busy}>{t('global_set_password')}</button>
      </form> : !error && <p>{t('loading')}…</p>}
    </section>
  </main>;
}
