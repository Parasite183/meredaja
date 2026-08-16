import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone'); // phone | code
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';

  async function sendCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/request-otp', { method: 'POST', body: { phone } });
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api('/api/auth/verify-otp', { method: 'POST', body: { phone, code } });
      setToken(res.token);
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  async function devFill() {
    try {
      const { code: c } = await api(`/api/auth/dev/otp?phone=${encodeURIComponent(phone)}`);
      if (c) setCode(c);
      else setError(t('otp.wrong'));
    } catch {
      setError(t('otp.wrong'));
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-3xl font-black text-white">መ</span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t('app.tagline')}</p>
        </div>

        <div className="card p-5">
          {step === 'phone' ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label className="field-label">{t('common.phone')}</label>
                <input
                  className="input"
                  type="tel"
                  inputMode="tel"
                  placeholder="+251 9__ ___ __"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm font-medium text-bad">{error}</p> : null}
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || !phone}>
                {busy ? t('common.loading') : t('common.sendCode')}
              </button>
              {isDev ? <p className="text-center text-xs text-ink-soft">{t('otp.devHint')}</p> : null}
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <p className="text-sm font-medium">{t('otp.codeSent', { phone })}</p>
              <div>
                <label className="field-label">{t('otp.code')}</label>
                <input
                  className="input text-center text-2xl font-bold tracking-[0.3em]"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
              {error ? <p className="text-sm font-medium text-bad">{error}</p> : null}
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
                {busy ? t('common.loading') : t('common.verify')}
              </button>
              {isDev ? (
                {isDevHost && (
                  <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={devFill}>
                    {t('otp.devFill')}
                  </button>
                )}
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>
                {t('otp.resend')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
