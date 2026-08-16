import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Home, ListChecks, FolderLock, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../App.jsx';

const NAV = [
  { to: '/', key: 'nav.home', Icon: Home, end: true },
  { to: '/processes', key: 'nav.processes', Icon: ListChecks },
  { to: '/vault', key: 'nav.vault', Icon: FolderLock },
  { to: '/settings', key: 'nav.settings', Icon: SettingsIcon },
];

export default function AppLayout() {
  const { t, locale, setLocale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col pb-20">
      {/* top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <button className="flex items-center gap-2" onClick={() => navigate('/')}>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-lg font-black text-white">መ</span>
            <span className="text-base font-bold tracking-tight">{t('app.name')}</span>
          </button>
          <div className="flex items-center gap-2">
            {user?.is_moderator ? (
              <NavLink to="/moderation" className={({ isActive }) => `btn btn-ghost btn-sm ${isActive ? 'nav-active' : ''}`}>
                <ShieldCheck size={16} />
                {t('nav.moderation')}
              </NavLink>
            ) : null}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setLocale(locale === 'am' ? 'en' : 'am')}
              title="Language"
            >
              {locale === 'am' ? 'EN' : 'አማ'}
            </button>
          </div>
        </div>
      </header>

      <main className="fade-in flex-1 px-4 py-4">
        <Outlet />
      </main>

      {/* bottom nav (mobile-first) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {NAV.map(({ to, key, Icon, end }) => (
            <NavLink
              key={key}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                  isActive ? 'nav-active text-brand' : 'text-ink-soft'
                }`
              }
            >
              <Icon size={20} strokeWidth={2.2} />
              <span>{t(key)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
