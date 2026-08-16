// ─────────────────────────────────────────────────────────────────────
// Auth routes: phone OTP sign-in (Zemen pattern).
//   POST /request-otp   — send a code (rate-limited per IP + phone)
//   POST /verify-otp    — exchange code for a JWT session
//   POST /signout       — revoke the current session
//   POST /sessions/revoke-all — revoke every session
//   GET  /me            — current user
//   GET  /dev/otp       — dev only: peek at the latest unused code
// ─────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, ok, badRequest, unauthorized } from '../http.js';
import { authMiddleware, issueSession, revokeSession, revokeAllSessions } from '../auth.js';
import { genOtp, normalizePhone, nowIso } from '../crypto.js';
import smsProvider from '../providers/sms.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { AUTH_LIMITS } from '../rate-limit.js';
import { clientIp } from '../rate-limit.js';

const router = Router();
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function publicUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    is_moderator: u.is_moderator,
    created_at: u.created_at,
  };
}

// Step 1: request an OTP.
router.post('/request-otp', AUTH_LIMITS.requestOtpIp, AUTH_LIMITS.requestOtpPhone, wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw badRequest('Enter a valid phone number', 'phone_invalid');

  await db.run('DELETE FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0', [phone, 'login']);
  const code = genOtp();
  await db.run(
    'INSERT INTO otp_codes (phone, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [phone, code, 'login', new Date(Date.now() + OTP_TTL_MS).toISOString(), nowIso()]
  );
  await smsProvider.sendOtp(phone, code);
  ok(res, { sent: true, expiresIn: OTP_TTL_MS / 1000 });
}));

// Step 2: verify the code → create or load the user, issue a token.
router.post('/verify-otp', AUTH_LIMITS.verifyOtpIp, AUTH_LIMITS.verifyOtpPhone, wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  if (!phone || !code) throw badRequest('Phone and code required', 'missing_fields');

  const latest = await db.get(
    "SELECT * FROM otp_codes WHERE phone = ? AND purpose = 'login' AND used = 0 ORDER BY id DESC LIMIT 1",
    [phone]
  );
  if (!latest) {
    logger.warn('auth_failed', { reason: 'no_code', phone, ip: clientIp(req) });
    throw unauthorized('Invalid or expired code');
  }
  if (Date.parse(latest.expires_at) < Date.now()) {
    logger.warn('auth_failed', { reason: 'expired', phone, ip: clientIp(req) });
    throw unauthorized('Code expired — request a new one');
  }
  if (latest.code !== code) {
    const attempts = latest.attempts + 1;
    logger.warn('auth_failed', { reason: 'wrong_code', phone, attempt: attempts, ip: clientIp(req) });
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await db.run('UPDATE otp_codes SET used = 1 WHERE id = ?', [latest.id]);
      throw unauthorized('Too many attempts — request a new code');
    }
    await db.run('UPDATE otp_codes SET attempts = ? WHERE id = ?', [attempts, latest.id]);
    throw unauthorized('Invalid or expired code');
  }

  await db.run('UPDATE otp_codes SET used = 1 WHERE id = ?', [latest.id]);

  let user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
  let isNew = false;
  const device = String(req.body?.device || '').slice(0, 200);
  const ip = clientIp(req);
  if (!user) {
    isNew = true;
    const { lastId } = await db.run(
      'INSERT INTO users (phone, device_fingerprint, signup_ip, last_ip, created_at) VALUES (?, ?, ?, ?, ?)',
      [phone, device, ip, ip, nowIso()]
    );
    user = await db.get('SELECT * FROM users WHERE id = ?', [lastId]);
  } else {
    await db.run(
      `UPDATE users SET last_ip = ?,
              device_fingerprint = CASE WHEN device_fingerprint = '' THEN ? ELSE device_fingerprint END
       WHERE id = ?`,
      [ip, device, user.id]
    );
    user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  }
  const { token } = await issueSession(user, device, ip);
  ok(res, { token, user: publicUser(user), isNew });
}));

router.post('/signout', authMiddleware, wrap(async (req, res) => {
  await revokeSession(req.token.jti);
  ok(res, { signedOut: true });
}));

router.post('/sessions/revoke-all', authMiddleware, wrap(async (req, res) => {
  await revokeAllSessions(req.user.id);
  ok(res, { revoked: true });
}));

router.get('/me', authMiddleware, wrap(async (req, res) => {
  ok(res, { user: publicUser(req.user) });
}));

// Dev-only: peek at the latest unused OTP so demos stay clickable.
if (config.devMode) {
  router.get('/dev/otp', wrap(async (req, res) => {
    const phone = normalizePhone(req.query.phone);
    const row = await db.get(
      'SELECT code FROM otp_codes WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1',
      [phone]
    );
    ok(res, { phone, code: row?.code ?? null });
  }));
}

export default router;
