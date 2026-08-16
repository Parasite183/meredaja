// ─────────────────────────────────────────────────────────────────────
// Cloudflare Workers runtime bootstrap.
//
// Must be the FIRST import in server/worker.js: ESM evaluates imports
// in order, so by the time config.js / db.js / uploads.js run, the
// bindings are on globalThis and the string env vars are mirrored into
// process.env — exactly like a normal Node environment.
// ─────────────────────────────────────────────────────────────────────
import { env } from 'cloudflare:workers';

// Bindings (DB, UPLOADS, ...) are consumed lazily by db.js / uploads.js
// via globalThis.
globalThis.__MEREDAJA_BINDINGS = env;

// Mirror string vars + secrets into process.env so config.js behaves
// identically on Workers and on Node.
for (const [k, v] of Object.entries(env)) {
  if (typeof v === 'string') process.env[k] = v;
}

// Production semantics (disables the dev OTP-peek endpoint), but static
// file serving stays off — Cloudflare Pages handles the frontend.
//
// NOTE: wrangler's esbuild `define` rewrites the literal expression
// `process.env.NODE_ENV`, which would silently no-op a direct assignment
// (and config.js reads it via an aliased `const env = process.env`, so
// the define never applies there). Object.assign mutates the same object
// and cannot be define-replaced, so the value actually lands at runtime.
Object.assign(process.env, { NODE_ENV: 'production', MEREDAJA_WORKER: '1' });
