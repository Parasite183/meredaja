import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Paperclip, MessageSquarePlus, Upload, Flag, Building2 } from 'lucide-react';
import { api, uploadFile, useUploadUrl } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, ProgressBar, Badge, Modal } from '../components/ui.jsx';

function AttachmentThumb({ doc }) {
  const url = useUploadUrl(doc.file_path);
  const isImage = doc.mime_type?.startsWith('image/');
  if (isImage && url) {
    return <img src={url} alt={doc.file_name} className="h-16 w-16 rounded-lg border border-line object-cover" />;
  }
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-line bg-brand-soft text-[10px] font-bold text-brand">
      PDF
    </div>
  );
}

function ReportForm({ checklist, stepKey, onDone }) {
  const { t } = useI18n();
  const [wait, setWait] = useState('');
  const [office, setOffice] = useState('');
  const [waived, setWaived] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/reports', {
        method: 'POST',
        body: {
          process_slug: checklist.process_slug,
          region: checklist.region,
          step_key: stepKey,
          actual_wait_estimate: wait === '' ? null : Number(wait),
          office_location: office,
          requirement_waived: waived,
          note,
        },
      });
      setSent(true);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl bg-ok-soft p-4 text-center text-sm font-semibold text-ok">
        ✓ {t('proc.report.sent')}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">{t('proc.report.wait')}</label>
          <input className="input" type="number" min="0" placeholder={t('proc.report.waitPh')} value={wait} onChange={(e) => setWait(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('proc.report.office')}</label>
          <input className="input" placeholder={t('proc.report.officePh')} value={office} onChange={(e) => setOffice(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} className="h-4 w-4 accent-brand" />
        {t('proc.report.waived')}
      </label>
      <div>
        <label className="field-label">{t('proc.report.note')}</label>
        <textarea className="input min-h-[80px]" placeholder={t('proc.report.notePh')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error ? <p className="text-sm font-medium text-bad">{error}</p> : null}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? t('common.loading') : t('proc.report.submit')}
      </button>
    </form>
  );
}

export default function Checklist() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [checklist, setChecklist] = useState(null);
  const [regions, setRegions] = useState({});
  const [vaultDocs, setVaultDocs] = useState([]);
  const [attachStep, setAttachStep] = useState(null); // stepKey of the open attach modal
  const [reportStep, setReportStep] = useState(null); // stepKey of the open report modal
  const [notes, setNotes] = useState({}); // {stepKey: note}
  const [savingNote, setSavingNote] = useState({});

  const load = useCallback(async () => {
    const [cl, rg] = await Promise.all([api(`/api/checklists/${id}?locale=${locale}`), api('/api/regions')]);
    const map = {};
    for (const r of rg.regions) map[r.id] = locale === 'am' ? r.am : r.en;
    setRegions(map);
    setChecklist(cl.checklist);
    const n = {};
    for (const s of cl.checklist.steps) n[s.key] = s.note;
    setNotes(n);
  }, [id, locale]);

  useEffect(() => {
    load().catch(() => navigate('/'));
  }, [load, navigate]);

  async function toggleStep(step) {
    const next = step.status === 'done' ? 'todo' : 'done';
    setChecklist((c) => ({
      ...c,
      steps: c.steps.map((s) => (s.key === step.key ? { ...s, status: next } : s)),
    }));
    const res = await api(`/api/checklists/${id}/steps/${step.key}`, {
      method: 'PATCH',
      body: { status: next, note: notes[step.key] || '' },
    });
    setChecklist((c) => ({ ...c, completed: res.completed, doneCount: res.doneCount, totalSteps: res.totalSteps }));
  }

  async function saveNote(stepKey) {
    setSavingNote((s) => ({ ...s, [stepKey]: true }));
    try {
      await api(`/api/checklists/${id}/steps/${stepKey}`, {
        method: 'PATCH',
        body: { status: checklist.steps.find((s) => s.key === stepKey).status, note: notes[stepKey] || '' },
      });
      setTimeout(() => setSavingNote((s) => ({ ...s, [stepKey]: false })), 800);
    } catch {
      setSavingNote((s) => ({ ...s, [stepKey]: false }));
    }
  }

  async function attachDocument(docId) {
    await api(`/api/checklists/${id}/attachments`, {
      method: 'POST',
      body: { document_id: docId, step_key: attachStep },
    });
    setAttachStep(null);
    await load();
  }

  async function detach(stepKey, docId) {
    await api(`/api/checklists/${id}/attachments/${docId}?step_key=${stepKey}`, { method: 'DELETE' });
    await load();
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadFile('/api/documents', file, { type: 'other' });
      await attachDocument(res.document.id);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  }

  async function openAttach(stepKey) {
    setAttachStep(stepKey);
    try {
      const docs = await api('/api/documents');
      setVaultDocs(docs.documents);
    } catch {
      setVaultDocs([]);
    }
  }

  if (!checklist) return <Spinner label={t('common.loading')} />;

  const done = checklist.steps.filter((s) => s.status === 'done').length;
  const reportsByStep = {};
  for (const r of checklist.reports || []) (reportsByStep[r.step_key] ||= []).push(r);

  return (
    <div className="space-y-5">
      <button className="btn btn-ghost btn-sm -ml-2" onClick={() => navigate('/')}>
        <ArrowLeft size={16} />
        {t('cl.backToDash')}
      </button>

      <div>
        <h1 className="text-xl font-extrabold leading-snug">{checklist.process.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {regions[checklist.region] || checklist.region} · v{checklist.process.version}
        </p>
        <div className="mt-3">
          <ProgressBar done={done} total={checklist.totalSteps} />
          <p className="mt-1 text-xs font-semibold text-ink-soft">{t('dash.progress', { done, total: checklist.totalSteps })}</p>
        </div>
      </div>

      {checklist.completed ? (
        <div className="rounded-xl bg-ok-soft p-4">
          <p className="font-bold text-ok">✓ {t('cl.allDone')}</p>
          <p className="mt-1 text-sm">{t('cl.allDoneHint')}</p>
        </div>
      ) : null}

      {/* steps */}
      <div className="space-y-3">
        {checklist.steps.map((step, i) => (
          <div key={step.key} className={`card p-4 ${step.status === 'done' ? 'opacity-90' : ''}`}>
            <div className="flex items-start gap-3">
              <button
                onClick={() => toggleStep(step)}
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  step.status === 'done' ? 'border-ok bg-ok text-white' : 'border-line bg-card text-transparent hover:border-brand'
                }`}
                aria-label={step.status === 'done' ? t('cl.step.done') : t('cl.step.todo')}
              >
                <Check size={16} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`font-bold leading-snug ${step.status === 'done' ? 'text-ink-soft line-through' : ''}`}>
                    {i + 1}. {step.title}
                  </h3>
                  <Badge color={step.status === 'done' ? 'ok' : 'muted'}>
                    {step.status === 'done' ? t('cl.step.done') : t('cl.step.todo')}
                  </Badge>
                </div>
                {step.description ? <p className="mt-1 text-sm text-ink-soft">{step.description}</p> : null}
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
                  <Building2 size={13} className="mt-0.5 shrink-0 text-brand" />
                  {step.responsible_office}
                </p>

                {/* note */}
                <div className="mt-3">
                  <textarea
                    className="input min-h-[52px] text-sm"
                    placeholder={t('cl.note.placeholder')}
                    value={notes[step.key] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [step.key]: e.target.value }))}
                    onBlur={() => saveNote(step.key)}
                  />
                  {savingNote[step.key] ? <p className="mt-1 text-right text-[11px] text-ok">{t('cl.note.saved')}</p> : null}
                </div>

                {/* attachments */}
                {step.attachments.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {step.attachments.map((doc) => (
                      <div key={doc.document_id} className="relative">
                        <AttachmentThumb doc={doc} />
                        <button
                          onClick={() => detach(step.key, doc.document_id)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bad text-[10px] font-bold text-white"
                          title={t('common.detach')}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => openAttach(step.key)}>
                    <Paperclip size={14} />
                    {t('cl.attachDoc')}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setReportStep(step.key)}>
                    <MessageSquarePlus size={14} />
                    {t('cl.reportCta')}
                  </button>
                </div>

                {/* community reports on this step */}
                {reportsByStep[step.key]?.length > 0 ? (
                  <div className="mt-3 rounded-xl bg-warn-soft p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-warn">{t('cl.reports')}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {reportsByStep[step.key].map((r) => (
                        <li key={r.id} className="text-xs">
                          <div className="flex items-center gap-2">
                            {r.actual_wait_estimate !== null ? (
                              <span className="badge bg-white/80 text-warn">{t('proc.report.days', { n: r.actual_wait_estimate })}</span>
                            ) : null}
                            {r.office_location ? <span className="font-medium">{r.office_location}</span> : null}
                            {r.requirement_waived ? <span className="badge bg-white/80 text-ok">{t('proc.report.waved')}</span> : null}
                          </div>
                          {r.note ? <p className="mt-0.5 text-ink">{r.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* attach modal */}
      <Modal open={!!attachStep} onClose={() => setAttachStep(null)} title={t('cl.attachDocTitle')}>
        <p className="mb-3 text-sm text-ink-soft">{t('cl.attachDocHint')}</p>
        {vaultDocs.length === 0 ? (
          <p className="mb-3 text-sm">{t('cl.attachDocEmpty')}</p>
        ) : (
          <ul className="mb-4 max-h-64 space-y-2 overflow-y-auto">
            {vaultDocs.map((d) => (
              <li key={d.id}>
                <button className="btn btn-secondary btn-sm btn-block justify-start" onClick={() => attachDocument(d.id)}>
                  <Paperclip size={14} />
                  {d.file_name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="btn btn-primary btn-sm btn-block cursor-pointer">
          <Upload size={14} />
          {t('cl.attachUpload')}
          <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
        </label>
      </Modal>

      {/* report modal */}
      <Modal open={!!reportStep} onClose={() => setReportStep(null)} title={t('proc.report.title')}>
        <p className="mb-3 text-sm text-ink-soft">{t('proc.report.subtitle')}</p>
        {reportStep ? <ReportForm checklist={checklist} stepKey={reportStep} onDone={load} /> : null}
      </Modal>
    </div>
  );
}
