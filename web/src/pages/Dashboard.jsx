import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useAuth } from '../App.jsx';
import { Spinner, ProgressBar, Badge } from '../components/ui.jsx';

export default function Dashboard() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState(null);
  const [regions, setRegions] = useState({});

  useEffect(() => {
    Promise.all([
      api(`/api/checklists?locale=${locale}`),
      api('/api/regions'),
    ])
      .then(([cl, rg]) => {
        setChecklists(cl.checklists);
        const map = {};
        for (const r of rg.regions) map[r.id] = locale === 'am' ? r.am : r.en;
        setRegions(map);
      })
      .catch(() => setChecklists([]));
  }, [locale]);

  async function abandon(id) {
    if (!confirm(t('dash.abandon') + '?')) return;
    await api(`/api/checklists/${id}`, { method: 'DELETE' });
    setChecklists((cs) => cs.filter((c) => c.id !== id));
  }

  if (!checklists) return <Spinner label={t('common.loading')} />;

  const inProgress = checklists.filter((c) => !c.completed);
  const completed = checklists.filter((c) => c.completed);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{t('dash.greeting', { name: user?.name || user?.phone })}</h1>
        <p className="text-sm text-ink-soft">{t('dash.subtitle')}</p>
      </div>

      {checklists.length === 0 ? (
        <div className="card p-8 text-center">
          <ListChecks className="mx-auto mb-3 text-brand" size={36} />
          <p className="font-semibold">{t('dash.empty')}</p>
          <p className="mt-1 text-sm text-ink-soft">{t('dash.emptyHint')}</p>
          <Link to="/processes" className="btn btn-primary btn-block mt-4">
            <Plus size={18} />
            {t('dash.browse')}
          </Link>
        </div>
      ) : null}

      {inProgress.map((c) => (
        <div key={c.id} className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-bold leading-snug">{c.process_name}</h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                {regions[c.region] || c.region} · {t('dash.started', { date: new Date(c.started_at).toLocaleDateString() })}
              </p>
            </div>
            <Badge color="brand">{t('dash.progress', { done: c.doneCount, total: c.totalSteps })}</Badge>
          </div>
          <div className="mt-3">
            <ProgressBar done={c.doneCount} total={c.totalSteps} />
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary btn-sm flex-1" onClick={() => navigate(`/checklists/${c.id}`)}>
              {t('dash.resume')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => abandon(c.id)}>
              {t('dash.abandon')}
            </button>
          </div>
        </div>
      ))}

      {completed.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">{t('dash.completed')}</h3>
          {completed.map((c) => (
            <div key={c.id} className="card mb-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold">{c.process_name}</h2>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {regions[c.region] || c.region} · {t('dash.completedOn', { date: new Date(c.completed_at).toLocaleDateString() })}
                  </p>
                </div>
                <Badge color="ok">✓ {t('dash.completed')}</Badge>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
