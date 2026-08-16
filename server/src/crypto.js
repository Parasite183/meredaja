// ─────────────────────────────────────────────────────────────────────
// Small shared helpers: ids, hashes, OTP generation, phone normalisation.
// Same vocabulary as Zemen's crypto.js.
// ─────────────────────────────────────────────────────────────────────
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export const genOtp = () => String(randomInt(100000, 1000000));

/** Random hex id for session tokens. */
export const genId = () => randomBytes(16).toString('hex');

export const nowIso = () => new Date().toISOString();

/** Normalise a phone number: digits only, keep leading + */
export function normalizePhone(raw) {
  const s = String(raw || '').trim().replace(/[\s()-]/g, '');
  if (!/^\+?\d{9,15}$/.test(s)) return null;
  return s;
}
