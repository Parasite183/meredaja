// ─────────────────────────────────────────────────────────────────────
// Document vault routes.
//   POST   /api/documents            — upload (multipart: file + type)
//   GET    /api/documents            — my documents
//   GET    /api/documents/:id        — metadata
//   GET    /uploads/documents/:id.enc — decrypted bytes, owner-only
//   DELETE /api/documents/:id        — delete file + attachments
//
// Upload path: multer buffers in memory (10 MB cap) → magic-byte
// verification (assertUploadContent) → AES-256-GCM encrypt → write
// <id>.enc to server/uploads/documents/. The plaintext never touches
// disk; the stored mime_type is the SNIFFED type, never the client's
// claim.
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, ok, badRequest, notFound } from '../http.js';
import { authMiddleware } from '../auth.js';
import { nowIso, sha256 } from '../crypto.js';
import { uploadDocument, assertUploadContent, writeEncryptedDocument, readEncryptedDocument, deleteUploadedFile, TYPE_TO_MIME } from '../uploads.js';

const router = Router();
router.use(authMiddleware);

// Fixed vocabulary of document types (vault tags). Extend here; the
// process data references these types for required documents.
export const DOCUMENT_TYPES = [
  'national_id',
  'passport_photo',
  'address_proof',
  'lease_agreement',
  'name_certificate',
  'tin_certificate',
  'tax_clearance',
  'business_plan',
  'payment_receipt',
  'business_docs',
  'name_availability',
  'name_approval',
  'application_receipt',
  'other',
];

export function docTypeLabel(type) {
  return type || 'other';
}

router.post('/', uploadDocument, wrap(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded', 'file_missing');
  const type = String(req.body?.type || 'other').trim();
  if (!DOCUMENT_TYPES.includes(type)) throw badRequest('Unknown document type', 'doc_type_unknown');

  // Magic-byte verification — the sniffed type is authoritative.
  let detected;
  try {
    detected = assertUploadContent(req.file, { badRequest });
  } catch (err) {
    throw err;
  }

  const plaintext = req.file.buffer;
  const hash = sha256(plaintext);

  // Exact-duplicate guard within the user's own vault.
  const dup = await db.get('SELECT id FROM documents WHERE user_id = ? AND sha256 = ?', [req.user.id, hash]);
  if (dup) throw badRequest('You already uploaded this exact file', 'duplicate_file');

  const { lastId } = await db.run(
    `INSERT INTO documents (user_id, type, file_name, file_path, file_size, mime_type, sha256, uploaded_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
    [req.user.id, type, String(req.file.originalname || 'file').slice(0, 200), plaintext.length, TYPE_TO_MIME[detected], hash, nowIso()]
  );
  const filePath = await writeEncryptedDocument(lastId, plaintext);
  await db.run('UPDATE documents SET file_path = ? WHERE id = ?', [filePath, lastId]);

  const doc = await db.get('SELECT id, user_id, type, file_name, file_path, file_size, mime_type, uploaded_at FROM documents WHERE id = ?', [lastId]);
  ok(res, { document: doc }, 201);
}));

router.get('/', wrap(async (req, res) => {
  const rows = await db.all(
    `SELECT d.*, (SELECT COUNT(*) FROM document_attachments a WHERE a.document_id = d.id) AS attachment_count
     FROM documents d WHERE d.user_id = ? ORDER BY d.uploaded_at DESC`,
    [req.user.id]
  );
  ok(res, { documents: rows });
}));

router.get('/:id', wrap(async (req, res) => {
  const doc = await db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!doc) throw notFound('Document not found');
  ok(res, { document: doc });
}));

router.delete('/:id', wrap(async (req, res) => {
  const doc = await db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!doc) throw notFound('Document not found');
  await db.tx(async () => {
    await db.run('DELETE FROM document_attachments WHERE document_id = ?', [doc.id]);
    await db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
  });
  await deleteUploadedFile(doc.file_path);
  ok(res, { deleted: true });
}));

// ── serving decrypted bytes (owner-only gate in app.js) ──────────────
//
// Documents are readable by their owner and only their owner. There is
// deliberately NO moderator override: no moderation task in Meredaja
// (verifying process steps, reviewing flagged reports) requires viewing
// a user's private ID/lease documents, so a blanket moderator bypass
// would be a standing backdoor with no legitimate use. If a future
// feature (e.g. a formal appeal/dispute) needs moderator document
// review, it must be a specific request tied to a specific document and
// logged the same way step_verification_log records actions — not a
// blanket permission.
export async function serveDocument(req, res) {
  const docId = req.params.id;
  const doc = await db.get('SELECT * FROM documents WHERE id = ?', [docId]);
  if (!doc) return res.status(404).json({ error: 'Not found', code: 'not_found' });
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'unauthorized' });
  if (doc.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
  }
  try {
    const bytes = await readEncryptedDocument(doc.file_path);
    res.set('content-type', doc.mime_type || 'application/octet-stream');
    res.set('content-disposition', `inline; filename="${String(doc.file_name || 'document').replace(/"/g, '')}"`);
    res.set('cache-control', 'private, max-age=300');
    res.send(bytes);
  } catch {
    res.status(500).json({ error: 'Could not decrypt document', code: 'decrypt_failed' });
  }
}

export default router;
