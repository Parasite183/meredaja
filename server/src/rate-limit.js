// ─────────────────────────────────────────────────────────────────────
// Basic abuse protection: fixed-window rate limiting (Zemen's
// rate-limit.js pattern, trimmed to what Meredaja needs).
//
//   rateLimit({ name, windowMs, max, keyFn })  → middleware
//
// Keyers provided:
//   ipKey(req)      — client IP (req.ip; coarse and NAT-tolerant)
//   accountKey(req) — authed user id (null when anonymous)
//
// ⚠️ Honest limitation: counters are in-memory per process, so a
//    distributed attacker can exceed the limit. This is a deliberate
//    baseline, not a full DDoS defense — fine for a local prototype.
// ─────────────────────────────────────────────────────────────────────
import { logger } from './logger.js';

export function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim();
}

export function ipKey(req) {
  return clientIp(req) ? `ip:${clientIp(req)}` : null;
}

export function accountKey(req) {
  return req.user?.id ? `acct:${req.user.id}` : null;
}

export function rateLimit({ name, windowMs, max, keyFn }) {
  if (!name || !windowMs || !max || !keyFn) throw new Error('rateLimit requires { name, windowMs, max, keyFn }');
  const hits = new Map();

  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    const bucket = hits.get(key);

    if (!bucket || bucket.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10000) {
        for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
      }
      res.set('ratelimit-limit', String(max));
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('ratelimit-limit', String(max));
      res.set('retry-after', String(retryAfter));
      logger.warn('rate_limited', { limiter: name, key });
      return res.status(429).json({ error: 'Too many requests — try again shortly', code: 'rate_limited' });
    }
    return next();
  };
}

// ── preconfigured limiters ───────────────────────────────────────────
export const AUTH_LIMITS = {
  requestOtpIp: rateLimit({ name: 'request-otp-ip', windowMs: 60_000, max: 5, keyFn: ipKey }),
  requestOtpPhone: rateLimit({ name: 'request-otp-phone', windowMs: 15 * 60_000, max: 10, keyFn: (req) => (req.body?.phone ? `phone:${String(req.body.phone).trim()}` : null) }),
  verifyOtpIp: rateLimit({ name: 'verify-otp-ip', windowMs: 60_000, max: 10, keyFn: ipKey }),
  verifyOtpPhone: rateLimit({ name: 'verify-otp-phone', windowMs: 60_000, max: 15, keyFn: (req) => (req.body?.phone ? `phone:${String(req.body.phone).trim()}` : null) }),
};

export const REPORT_LIMITS = {
  // Per account per process (24h window): a handful of reports per
  // process keeps the reality-check layer honest.
  reportUser: rateLimit({ name: 'report-user', windowMs: 24 * 60 * 60_000, max: 5, keyFn: (req) => (req.user?.id && req.body?.process_slug ? `report:${req.user.id}:${String(req.body.process_slug)}` : null) }),
  reportIp: rateLimit({ name: 'report-ip', windowMs: 60 * 60_000, max: 30, keyFn: ipKey }),
  flagUser: rateLimit({ name: 'flag-user', windowMs: 60 * 60_000, max: 20, keyFn: accountKey }),
};
