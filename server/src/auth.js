// ─────────────────────────────────────────────────────────────────────
// Auth: phone-number OTP sign-in with a stateless JWT backed by
// server-side session rows (same pattern as Zemen's auth.js). The JWT's
// jti must match a live (non-revoked) sessions row, which is what makes
// "sign out of all devices" actually revoke tokens.
// ─────────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { genId, nowIso } from './crypto.js';
import { unauthorized } from './http.js';

export const JWT_TTL = '7d';
const REFRESH_AFTER_SECONDS = 6 * 86400;

export function signToken(user, jti) {
  return jwt.sign({ sub: user.id, phone: user.phone, jti }, config.jwtSecret, { expiresIn: config.jwtTtl || JWT_TTL });
}

/** Create a server-side session and mint a token for it. */
export async function issueSession(user, device = '', ip = '') {
  const jti = genId();
  await db.run(
    'INSERT INTO sessions (user_id, token_id, device_info, created_at) VALUES (?, ?, ?, ?)',
    [user.id, jti, String(device || '').slice(0, 200), nowIso()]
  );
  return { token: signToken(user, jti), jti };
}

export async function revokeSession(tokenId) {
  await db.run('UPDATE sessions SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL', [nowIso(), tokenId]);
}

export async function revokeAllSessions(userId) {
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
}

/** Attach `req.user` (fresh from the DB) + `req.session` on a valid token. */
export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [payload.sub]);
    if (!user) return next(unauthorized('Account no longer exists'));
    const session = await db.get('SELECT * FROM sessions WHERE token_id = ?', [payload.jti]);
    if (!session || session.revoked_at) return next(unauthorized('Session revoked — sign in again'));
    req.user = user;
    req.token = payload;
    req.session = session;

    // Silent refresh: near-expiry tokens get a fresh one via response header.
    if (payload.iat && Date.now() / 1000 - payload.iat > REFRESH_AFTER_SECONDS) {
      res.set('x-meredaja-refresh', signToken(user, session.token_id));
    }
    await db.run('UPDATE sessions SET last_seen_at = ? WHERE token_id = ?', [nowIso(), session.token_id]).catch(() => {});
    next();
  } catch {
    next(unauthorized('Session expired, sign in again'));
  }
}

export function isModerator(user) {
  return !!(user && user.is_moderator);
}

export const requireModerator = (req, _res, next) => {
  if (!isModerator(req.user)) return next(Object.assign(new Error('Moderator role required'), { status: 403, code: 'forbidden' }));
  next();
};
