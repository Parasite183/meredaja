import { useEffect, useState } from 'react';
import { ShieldCheck, Check, EyeOff } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, Badge } from '../components/ui.jsx';

export default function Moderation() {
  const { t } = useI18n();
  const [reports, setReports] = useState(null);

  const load = () =>
    api('/api/moderation/reports?status=flagged')
      .then((d) => setReports(d.reports))
      .catch(() => setReports([]));
  useEffect(() => { load(); }, []);

  async function act(id, action) {
    await api(`/api/moderation/reports/${id}`, { method: 'POST', body: { action } });
    await load();
  }

  if (!reports) return <Spinner label={t('common.loading')} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <ShieldCheck size={22} className="text-brand" />
          {t('mod.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t('mod.subtitle')}</p>
      </div>

      {reports.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold text-ok">✓ {t('mod.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge color="warn">{t('mod.flagged')}</Badge>
                <span className="text-xs text-ink-soft">
                  {r.process_slug} · {r.region} · step {r.step_key} · {t('mod.reporter', { phone: r.reporter_phone })}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                {r.actual_wait_estimate !== null ? (
                  <p><strong>{t('proc.report.wait')}:</strong> {r.actual_wait_estimate}</p>
                ) : null}
                {r.office_location ? <p><strong>{t('proc.report.office')}:</strong> {r.office_location}</p> : null}
                {r.requirement_waived ? <p><strong>{t('proc.report.waived')}:</strong> ✓</p> : null}
                {r.note ? <p className="text-ink-soft">“{r.note}”</p> : null}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-secondary btn-sm flex-1" onClick={() => act(r.id, 'approve')}>
                  <Check size={14} className="text-ok" />
                  {t('mod.approve')}
                </button>
                <button className="btn btn-secondary btn-sm flex-1" onClick={() => act(r.id, 'hide')}>
                  <EyeOff size={14} className="text-bad" />
                  {t('mod.hide')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
