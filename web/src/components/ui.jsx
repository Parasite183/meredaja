import { useI18n } from '../i18n/index.jsx';

export function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
      {label ? <p className="text-sm text-ink-soft">{label}</p> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children }) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="card fade-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

const BADGE_COLORS = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  bad: 'bg-bad-soft text-bad',
  brand: 'bg-brand-soft text-brand',
  muted: 'bg-slate-100 text-ink-soft',
};

export function Badge({ color = 'muted', children }) {
  return <span className={`badge ${BADGE_COLORS[color] || BADGE_COLORS.muted}`}>{children}</span>;
}
