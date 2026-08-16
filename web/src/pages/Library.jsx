import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, MapPin, Info } from 'lucide-react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, Badge } from '../components/ui.jsx';

const CATEGORY_ORDER = ['license', 'tax', 'name', 'other'];

export default function Library() {
  const { t, locale } = useI18n();
  const [state, setState] = useState({ processes: null, regions: {} });

  useEffect(() => {
    Promise.all([api(`/api/processes?locale=${locale}`), api('/api/regions')]).then(([p, rg]) => {
      const map = {};
      for (const r of rg.regions) map[r.id] = locale === 'am' ? r.am : r.en;
      setState({ processes: p.processes, regions: map });
    });
  }, [locale]);

  if (!state.processes) return <Spinner label={t('common.loading')} />;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: state.processes.filter((p) => p.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{t('lib.title')}</h1>
        <p className="text-sm text-ink-soft">{t('lib.subtitle')}</p>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-xs text-ink">
        <Info size={16} className="mt-0.5 shrink-0 text-info" />
        <p>{t('lib.dataNote')}</p>
      </div>

      {grouped.map(({ cat, items }) => (
        <div key={cat}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">{t(`lib.category.${cat}`)}</h2>
          <div className="space-y-3">
            {items.map((p) => (
              <Link key={p.slug} to={`/processes/${p.slug}`} className="card block p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold leading-snug">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{p.summary}</p>
                  </div>
                  <Badge color="brand">
                    <ListChecks size={12} />
                    {t('lib.steps', { n: p.step_count })}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-ink-soft">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} />
                    {state.regions[p.default_region] || p.default_region}
                  </span>
                  {p.available_regions.length > 1 ? (
                    <span>+{p.available_regions.length - 1} {t('lib.region')}</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
