import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Languages, ShieldAlert, Trash2 } from 'lucide-react';
import { api, clearToken } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../App.jsx';

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function signOutAll() {
    try { await api('/api/auth/sessions/revoke-all', { method: 'POST' }); } catch {}
    signOut();
    navigate('/login');
  }

  async function deleteEverything() {
    if (confirmText !== 'DELETE') return;
    setBusy(true);
    try {
      await api('/api/me', { method: 'DELETE' });
      clearToken();
      setDeleted(true);
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg font-bold text-ok">✓ {t('settings.deleted')}</p>
        <button className="btn btn-primary btn-block mt-4" onClick={() => navigate('/login')}>
          {t('common.signIn')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{user?.phone}</p>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
          <Languages size={15} />
          {t('settings.language')}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn ${locale === 'en' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLocale('en')}>
            {t('settings.lang.en')}
          </button>
          <button className={`btn ${locale === 'am' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLocale('am')}>
            {t('settings.lang.am')}
          </button>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
          <LogOut size={15} />
          {t('settings.account')}
        </h2>
        <button className="btn btn-secondary btn-block" onClick={signOutAll}>
          {t('settings.sessions')}
        </button>
      </div>

      <div className="card border-bad-soft p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-bad">
          <ShieldAlert size={15} />
          {t('settings.danger')}
        </h2>
        <p className="mb-3 text-sm text-ink-soft">{t('settings.deleteAllHint')}</p>
        <input
          className="input mb-3"
          placeholder={t('settings.deleteAllConfirm')}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        <button
          className="btn btn-danger btn-block"
          disabled={confirmText !== 'DELETE' || busy}
          onClick={deleteEverything}
        >
          <Trash2 size={16} />
          {busy ? t('common.loading') : t('settings.deleteAll')}
        </button>
      </div>

      <p className="pb-2 text-center text-xs text-ink-soft">{t('settings.dev')} · v0.1.0</p>
    </div>
  );
}
