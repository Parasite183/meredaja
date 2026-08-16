// ─────────────────────────────────────────────────────────────────────
// Configuration. Zero-config local development by default; production
// refuses to boot with dev defaults (same philosophy as Zemen's
// config.js — fail loudly, never silently fall back to a stub).
// ─────────────────────────────────────────────────────────────────────
import 'dotenv/config';

const env = process.env;

export const DEV_JWT_SECRET = 'meredaja-dev-secret-change-me';
// Dev-only encryption key for documents at rest (AES-256-GCM). Derived
// from a fixed string so a fresh checkout can run with zero config; in
// production MEREDAJA_ENC_KEY must be a real 32-byte secret.
export const DEV_ENC_KEY = 'meredaja-dev-doc-encryption-key-0000';

export const config = {
  port: Number(env.PORT || 3001),
  dbFile: env.DB_FILE || './data/meredaja.db',
  databaseUrl: (env.DATABASE_URL || '').trim(),
  jwtSecret: env.JWT_SECRET || DEV_JWT_SECRET,
  // Encryption key for documents at rest. The dev default is derived
  // deterministically; production REQUIRES MEREDAJA_ENC_KEY (see
  // validateConfig below).
  encKey: env.MEREDAJA_ENC_KEY || DEV_ENC_KEY,
  // Dev-only helpers (OTP peek endpoint) are NEVER active in production.
  devMode: env.NODE_ENV !== 'production' && env.DEV_MODE !== 'false',
  nodeEnv: env.NODE_ENV || 'development',
  smsProvider: env.SMS_PROVIDER || 'console',
  jwtTtl: env.JWT_TTL || '7d',
  // True when running as a Cloudflare Worker (see server/worker.js).
  // Static file serving and local disk uploads are disabled in that mode.
  worker: env.MEREDAJA_WORKER === '1',
};

/** Absolute path to the `server` package root. */
// import.meta.url is not a usable URL base on Cloudflare Workers, so
// fall back to a placeholder (only used for local disk paths there).
export const serverRoot = new URL('..', import.meta.url || 'file:///meredaja/server/').pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Startup configuration validation. Returns a list of problems; an empty
 * list means the process is safe to boot. In development almost nothing
 * is required; in production every item below is mandatory so the server
 * never boots half-configured.
 */
export function validateConfig() {
  const problems = [];
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) return problems;

  const jwt = config.jwtSecret;
  if (!jwt) problems.push({ name: 'JWT_SECRET', message: 'must be set in production' });
  else if (jwt === DEV_JWT_SECRET) problems.push({ name: 'JWT_SECRET', message: 'must not be the development default' });
  else if (jwt.length < 32) problems.push({ name: 'JWT_SECRET', message: 'should be at least 32 characters' });

  if (config.encKey === DEV_ENC_KEY) {
    problems.push({ name: 'MEREDAJA_ENC_KEY', message: 'must be set to a real 32-byte secret in production (dev default is not allowed)' });
  }

  if (config.smsProvider === 'console') {
    problems.push({ name: 'SMS_PROVIDER', message: 'must be twilio or africastalking in production (console stub is dev-only)' });
  } else if (config.smsProvider === 'africastalking') {
    if (!env.AFRICASTALKING_API_KEY) problems.push({ name: 'AFRICASTALKING_API_KEY', message: 'required when SMS_PROVIDER=africastalking' });
    if (!env.AFRICASTALKING_USERNAME) problems.push({ name: 'AFRICASTALKING_USERNAME', message: 'required when SMS_PROVIDER=africastalking' });
  } else if (config.smsProvider === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID) problems.push({ name: 'TWILIO_ACCOUNT_SID', message: 'required when SMS_PROVIDER=twilio' });
    if (!env.TWILIO_AUTH_TOKEN) problems.push({ name: 'TWILIO_AUTH_TOKEN', message: 'required when SMS_PROVIDER=twilio' });
    if (!env.TWILIO_FROM) problems.push({ name: 'TWILIO_FROM', message: 'required when SMS_PROVIDER=twilio' });
  } else {
    problems.push({ name: 'SMS_PROVIDER', message: `unknown provider "${config.smsProvider}"` });
  }

  return problems;
}

/** Throw a formatted error listing every missing/misconfigured var. */
export function assertValidConfig() {
  const problems = validateConfig();
  if (problems.length) {
    const list = problems.map((p) => `  • ${p.name} — ${p.message}`).join('\n');
    const err = new Error(`Meredaja refuses to start: production configuration is incomplete.\n${list}`);
    err.status = 500;
    err.configProblems = problems;
    throw err;
  }
}
