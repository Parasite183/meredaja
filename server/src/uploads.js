// ─────────────────────────────────────────────────────────────────────
// File uploads (document vault).
//
// Security (mirrors Zemen's uploads.js, plus encryption at rest):
//   • strict allowlist — image/PDF only, enforced by claimed MIME type
//     AND filename extension
//   • max size — 10 MB per file (multer `limits`)
//   • magic-byte sniffing — assertUploadContent() rejects any file whose
//     real bytes don't match its claimed type (see sniffMime)
//   • encrypted at rest — AES-256-GCM; the plaintext never touches disk.
//     Files land as /uploads/documents/<id>.enc and are decrypted in
//     memory only when the owner fetches them (see documents route).
//   • private by default — the /uploads route is access-gated to the
//     owner only (see requireUploadAccess).
//
// Storage backend is swappable (same pattern as Zemen):
//   • Local disk  — default on plain Node (server/uploads/documents/)
//   • Cloudflare R2 — automatic on Workers with an R2 binding named
//     `UPLOADS` (object key = documents/<id>.enc)
// ─────────────────────────────────────────────────────────────────────
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { config, serverRoot } from './config.js';
import { db } from './db.js';

function bucket() {
  return (globalThis.__MEREDAJA_BINDINGS || {}).UPLOADS || null;
}

const UPLOAD_TYPES = /jpeg|jpg|png|gif|webp|pdf|heic|heif/;
const fileFilter = (_req, file, cb) => cb(null, UPLOAD_TYPES.test(file.mimetype) || UPLOAD_TYPES.test(file.originalname));
const limits = { fileSize: 10 * 1024 * 1024 };

// ── magic-byte sniffing ──────────────────────────────────────────────
// Canonical type detected from a file's actual content, not its claimed
// MIME type. A mismatch means the upload is lying about what it is.
const MAGIC = [
  ['pdf', (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46], // %PDF
  ['png', (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpeg', (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], // \xFF\xD8\xFF
  ['gif', (b) => b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a')],
  ['webp', (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'],
  ['heic', (b) => {
    if (b.length < 12 || b.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
    const brand = b.subarray(8, 12).toString('ascii');
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  }],
];

/** Detect the real type of `bytes` from magic bytes, or null. */
export function sniffMime(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  for (const [name, match] of MAGIC) if (match(b)) return name;
  return null;
}

const MIME_TO_TYPE = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
  'application/pdf': 'pdf',
};
const EXT_TO_TYPE = {
  '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.gif': 'gif',
  '.webp': 'webp', '.heic': 'heic', '.heif': 'heic', '.pdf': 'pdf',
};

/** MIME type to serve for each sniffed type. */
export const TYPE_TO_MIME = {
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
};

/**
 * Verify an uploaded file's real content matches its claimed type.
 * Returns the detected type, or throws a badRequest-style error.
 */
export function assertUploadContent(file, { badRequest } = {}) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw badRequest ? badRequest('Uploaded file is empty', 'file_empty') : new Error('Uploaded file is empty');
  }
  const detected = sniffMime(file.buffer);
  if (!detected) {
    throw badRequest ? badRequest('File type not allowed — images and PDF only', 'file_type_unsupported') : new Error('File type not allowed — images and PDF only');
  }
  const claimedMime = String(file.mimetype || '').toLowerCase();
  const claimedExt = String(path.extname(file.originalname || '')).toLowerCase();
  const claimedType = MIME_TO_TYPE[claimedMime] || EXT_TO_TYPE[claimedExt] || null;
  if (!claimedType) {
    throw badRequest ? badRequest('File type not allowed — images and PDF only', 'file_type_unsupported') : new Error('File type not allowed — images and PDF only');
  }
  if (claimedType !== detected) {
    throw badRequest ? badRequest('File content does not match its declared type', 'file_type_mismatch') : new Error('File content does not match its declared type');
  }
  return detected;
}

// ── encryption at rest (AES-256-GCM) ─────────────────────────────────
// The dev key in config is deterministic so a fresh checkout runs with
// zero config; production refuses to boot without a real MEREDAJA_ENC_KEY.
function encKey() {
  return crypto.createHash('sha256').update(config.encKey).digest(); // 32 bytes
}

export function encryptBytes(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]); // iv(12) + tag(16) + ciphertext
}

export function decryptBytes(blob) {
  if (blob.length < 28) throw new Error('corrupt encrypted file');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ── multer wiring ────────────────────────────────────────────────────
// Uploads are buffered in memory (capped at 10 MB), verified by magic
// bytes, encrypted, and written to server/uploads/documents/<id>.enc by
// the caller (documents route), so the DB owns the id↔path mapping.
const memoryStorage = multer.memoryStorage();

export const uploadDocument = multer({ storage: memoryStorage, fileFilter, limits }).single('file');

// ── access control for serving uploads ───────────────────────────────
// The /uploads route is mounted behind this gate. Documents belong to
// exactly one user: only the owner may read them. There is NO moderator
// bypass here — no moderation task needs to view a user's private
// documents, so a blanket override would just be a standing backdoor
// (see the matching note in routes/documents.js).
export function requireUploadAccess() {
  return async (req, res, next) => {
    try {
      const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
      if (!key) return next();
      if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'unauthorized' });

      const kind = key.split('/')[0];
      if (kind === 'documents') {
        const docId = path.posix.basename(key).replace(/\.enc$/, '');
        const doc = await db.get('SELECT user_id FROM documents WHERE id = ?', [docId]);
        if (doc && doc.user_id === req.user.id) return next();
      }
      return res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
    } catch (err) {
      next(err);
    }
  };
}

export function docsDir() {
  return path.join(serverRoot, 'uploads', 'documents');
}

/** `/uploads/documents/<id>.enc` → object key `documents/<id>.enc`. */
function objectKey(filePath) {
  return String(filePath || '').replace(/^\/+uploads\//, '');
}

export async function writeEncryptedDocument(docId, bytes) {
  const enc = encryptBytes(bytes);
  const b = bucket();
  if (b) {
    await b.put(`documents/${docId}.enc`, enc, { httpMetadata: { contentType: 'application/octet-stream' } });
    return `/uploads/documents/${docId}.enc`;
  }
  const dir = docsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${docId}.enc`);
  fs.writeFileSync(filePath, enc);
  return `/uploads/documents/${docId}.enc`;
}

export async function readEncryptedDocument(filePath) {
  const b = bucket();
  if (b) {
    const obj = await b.get(objectKey(filePath));
    if (!obj) throw new Error('object not found');
    return decryptBytes(Buffer.from(await obj.arrayBuffer()));
  }
  // Local disk: map /uploads/documents/<id>.enc back to disk.
  const diskPath = path.join(serverRoot, 'uploads', objectKey(filePath));
  const blob = fs.readFileSync(diskPath);
  return decryptBytes(blob);
}

export async function deleteUploadedFile(filePath) {
  const key = objectKey(filePath);
  if (!key.startsWith('documents/')) return;
  const b = bucket();
  if (b) {
    await b.delete(key).catch(() => {});
    return;
  }
  const diskPath = path.join(serverRoot, 'uploads', key);
  fs.rmSync(diskPath, { force: true });
}
