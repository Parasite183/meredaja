import { useEffect, useState, useRef } from 'react';
import { Upload, FolderLock, Trash2, FileText } from 'lucide-react';
import { api, uploadFile, useUploadUrl } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Spinner, Badge } from '../components/ui.jsx';

const DOC_TYPES = [
  'national_id', 'passport_photo', 'address_proof', 'lease_agreement',
  'name_certificate', 'tin_certificate', 'tax_clearance', 'business_plan',
  'payment_receipt', 'business_docs', 'name_availability', 'name_approval',
  'application_receipt', 'other',
];

function DocPreview({ doc }) {
  const url = useUploadUrl(doc.file_path);
  if (doc.mime_type?.startsWith('image/') && url) {
    return <img src={url} alt={doc.file_name} className="h-14 w-14 rounded-lg border border-line object-cover" />;
  }
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-brand-soft text-brand">
      <FileText size={22} />
    </div>
  );
}

export default function Vault() {
  const { t, locale } = useI18n();
  const [docs, setDocs] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const [type, setType] = useState('other');

  const load = () => api('/api/documents').then((d) => setDocs(d.documents)).catch(() => setDocs([]));
  useEffect(() => { load(); }, [locale]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await uploadFile('/api/documents', file, { type });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function remove(doc) {
    if (!confirm(t('vault.deleteConfirm'))) return;
    try {
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!docs) return <Spinner label={t('common.loading')} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <FolderLock size={22} className="text-brand" />
          {t('vault.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t('vault.subtitle')}</p>
      </div>

      {/* upload */}
      <div className="card p-4">
        <label className="field-label">{t('vault.type')}</label>
        <select className="input mb-3" value={type} onChange={(e) => setType(e.target.value)}>
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>{t(`vault.type.${dt}`)}</option>
          ))}
        </select>
        <button
          className="btn btn-primary btn-block"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={18} />
          {uploading ? t('common.loading') : t('vault.upload')}
        </button>
        <p className="mt-2 text-center text-xs text-ink-soft">{t('vault.uploadHint')}</p>
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
        {error ? <p className="mt-2 text-sm font-medium text-bad">{error}</p> : null}
      </div>

      {docs.length === 0 ? (
        <div className="card p-8 text-center">
          <FolderLock className="mx-auto mb-3 text-brand" size={36} />
          <p className="font-semibold">{t('vault.empty')}</p>
          <p className="mt-1 text-sm text-ink-soft">{t('vault.emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="card flex items-center gap-3 p-3">
              <DocPreview doc={d} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.file_name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                  <Badge color="info">{t(`vault.type.${d.type}`)}</Badge>
                  <span>{t('vault.uploaded', { date: new Date(d.uploaded_at).toLocaleDateString() })}</span>
                  {d.attachment_count > 0 ? <span>· {t('vault.attachedTo', { n: d.attachment_count })}</span> : null}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm text-bad" onClick={() => remove(d)} title={t('vault.delete')}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="pb-2 text-center text-xs text-ink-soft">🔒 {t('vault.encrypted')}</p>
    </div>
  );
}
