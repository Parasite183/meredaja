import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Building2, Clock, FileText, AlertTriangle, Play, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, Badge } from '../components/ui.jsx';

export default function ProcessDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [state, setState] = useState({ process: null, signals: {}, regions: {}, myChecklists: [] });

  useEffect(() => {
    let alive = true;
    Promise.all([api(`/api/processes/${slug}?locale=${locale}`), api('/api/regions')])
      .then(([p, rg]) => {
        if (!alive) return;
        const map = {};
        for (const r of rg.regions) map[r.id] = locale === 'am' ? r.am : r.en;
        setState((s) => ({ ...s, process: p.process, regions: map }));
      });
    return () => { alive = false; };
  }, [slug, locale]);

  // Region picker: re-resolve process + signals + my checklist state.
  // Initialises to the process default region once the process loads.
  const [region, setRegion] = useState('');
  useEffect(() => {
    if (state.process && region === '') setRegion(state.process.default_region);
  }, [state.process, region]);
  useEffect(() => {
    if (!region) return;
    let alive = true;
    Promise.all([
      api(`/api/processes/${slug}?locale=${locale}&region=${region}`),
      api(`/api/processes/${slug}/signals?region=${region}`),
      api('/api/checklists'),
    ]).then(([p, sig, cl]) => {
      if (!alive) return;
      setState((s) => ({
        ...s,
        process: p.process,
        signals: sig.signals,
        myChecklists: cl.checklists.filter((c) => c.process_slug === slug && c.region === region),
      }));
    });
    return () => { alive = false; };
  }, [slug, locale, region]);

  if (!state.process) return <Spinner label={t('common.loading')} />;

  const proc = state.process;
  const effectiveRegion = region || proc.default_region;
  const activeChecklist = state.myChecklists.find((c) => !c.completed);

  async function startChecklist() {
    try {
      const res = await api('/api/checklists', { method: 'POST', body: { process_slug: slug, region: effectiveRegion } });
      navigate(`/checklists/${res.checklist.id}`);
    } catch (err) {
      if (err.code === 'conflict') {
        // Re-fetch: someone started it meanwhile.
        const cl = await api('/api/checklists');
        const mine = cl.checklists.find((c) => c.process_slug === slug && c.region === effectiveRegion && !c.completed);
        if (mine) navigate(`/checklists/${mine.id}`);
      }
    }
  }

  return (
    <div className="space-y-5">
      <button className="btn btn-ghost btn-sm -ml-2" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        {t('common.back')}
      </button>

      <div>
        <Badge color="info">{t(`lib.category.${proc.category}`)}</Badge>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{proc.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">{proc.summary}</p>
      </div>

      {/* region picker */}
      <div>
        <label className="field-label">{t('proc.region')}</label>
        <div className="flex flex-wrap gap-2">
          {proc.available_regions.map((r) => (
            <button
              key={r}
              className={`btn btn-sm ${r === effectiveRegion ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRegion(r)}
            >
              <MapPin size={14} />
              {state.regions[r] || r}
            </button>
          ))}
        </div>
        {proc.region_notes ? (
          <p className="mt-2 rounded-lg bg-brand-soft p-3 text-xs text-ink">
            <strong>{t('proc.regionNotes')}: </strong>
            {proc.region_notes}
          </p>
        ) : null}
      </div>

      {activeChecklist ? (
        <button className="btn btn-primary btn-block" onClick={() => navigate(`/checklists/${activeChecklist.id}`)}>
          <Play size={18} />
          {t('proc.continue')} ({activeChecklist.doneCount}/{activeChecklist.totalSteps})
        </button>
      ) : (
        <button className="btn btn-primary btn-block" onClick={startChecklist}>
          <Play size={18} />
          {t('proc.start')}
        </button>
      )}

      {/* steps */}
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">{t('proc.steps')}</h2>
        <div className="space-y-3">
          {proc.steps.map((step, i) => {
            const sig = state.signals[step.key];
            return (
              <div key={step.key} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold leading-snug">{step.title}</h3>
                    {step.description ? <p className="mt-1 text-sm text-ink-soft">{step.description}</p> : null}
                  </div>
                </div>

                <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs text-ink-soft">
                  <p className="flex items-start gap-2">
                    <Building2 size={14} className="mt-0.5 shrink-0 text-brand" />
                    <span><strong className="text-ink">{t('proc.office')}:</strong> {step.responsible_office}</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <Clock size={14} className="mt-0.5 shrink-0 text-warn" />
                    <span><strong className="text-ink">{t('proc.timeline')}:</strong> {step.official_timeline}</span>
                  </p>
                  {step.required_documents.length > 0 ? (
                    <div className="flex items-start gap-2">
                      <FileText size={14} className="mt-0.5 shrink-0 text-info" />
                      <div>
                        <strong className="text-ink">{t('proc.documents')}:</strong>
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {step.required_documents.map((d, j) => (
                            <li key={j}>{d.label}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* community signal */}
                {sig && sig.count > 0 ? (
                  <div className="mt-3 rounded-xl bg-warn-soft p-3 text-xs">
                    <p className="font-semibold text-warn">{t('proc.signal.count', { n: sig.count })}</p>
                    {sig.avgWaitDays !== null ? (
                      <p className="mt-0.5">{t('proc.signal.avg', { days: sig.avgWaitDays })}</p>
                    ) : null}
                    {sig.waivers > 0 ? (
                      <p className="mt-0.5">{t('proc.signal.waivers', { n: sig.waivers })}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Object.entries(sig.buckets).filter(([, n]) => n > 0).map(([b, n]) => (
                        <span key={b} className="badge bg-white/70 text-warn">{b}: {n}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* common rejection reasons */}
      {proc.common_rejection_reasons.length > 0 ? (
        <div className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-bad">
            <AlertTriangle size={15} />
            {t('proc.rejectionReasons')}
          </h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-ink-soft">
            {proc.common_rejection_reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      ) : null}

      <p className="pb-2 text-center text-xs text-ink-soft">
        <CheckCircle2 size={12} className="mr-1 inline text-ok" />
        {t('lib.dataNote')}
      </p>
    </div>
  );
}
