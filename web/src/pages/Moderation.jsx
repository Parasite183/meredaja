import { useEffect, useState } from 'react';
import { ShieldCheck, Check, EyeOff, BadgeCheck, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, Badge, ConfidenceBadge } from '../components/ui.jsx';

export default function Moderation() {
  const { t } = useI18n();
  const [reports, setReports] = useState(null);
  const [steps, setSteps] = useState(null);

  const load = () =>
    Promise.all([
      api('/api/moderation/reports?status=flagged').then((d) => d.reports).catch(() => []),
      api('/api/moderation/steps').then((d) => d.steps).catch(() => []),
    ]).then(([r, s]) => { setReports(r); setSteps(s); });
  useEffect(() => { load(); }, []);

  async function act(id, action) {
    await api(`/api/moderation/reports/${id}`, { method: 'POST', body: { action } });
    await load();
  }

  async function verify(step, value) {
    if (value) {
      await api('/api/moderation/steps/verify', {
        method: 'POST',
        body: { process_slug: step.process_slug, region: step.region, step_key: step.step_key },
      });
    } else {
      await api(`/api/moderation/steps/verify?process_slug=${step.process_slug}&region=${step.region}&step_key=${step.step_key}`, { method: 'DELETE' });
    }
    await load();
  }

  if (!reports || !steps) return <Spinner label={t('common.loading')} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <ShieldCheck size={22} className="text-brand" />
          {t('mod.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t('mod.subtitle')}</p>
      </div>

      {/* verified / promoted steps */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
          <BadgeCheck size={15} className="text-ok" />
          {t('mod.verifications')}
        </h2>
        <p className="mb-3 text-xs text-ink-soft">{t('mod.verificationsHint')}</p>
        {steps.length === 0 ? (
          <p className="card p-4 text-sm text-ink-soft">{t('mod.noCandidates', { n: 3 })}</p>
        ) : (
          <ul className="space-y-3">
            {steps.map((s) => (
              <li key={`${s.process_slug}/${s.region}/${s.step_key}`} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug">{s.step_title}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {s.process_name} · {s.region}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">{t('mod.reportsOnStep', { n: s.report_count })}</p>
                  </div>
                  <ConfidenceBadge level={s.confidence} />
                </div>
                {s.confidence === 'verified' ? (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-soft">
                      {s.verified_at ? t('mod.verifiedOn', { date: new Date(s.verified_at).toLocaleDateString() }) : t('mod.verified')}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={() => verify(s, false)}>
                      <RotateCcw size={13} />
                      {t('mod.unverify')}
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-primary btn-sm mt-3 w-full" onClick={() => verify(s, true)}>
                    <BadgeCheck size={14} />
                    {t('mod.verify')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* flagged reports queue */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">{t('mod.title')}</h2>
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
      </section>
    </div>
  );
}
