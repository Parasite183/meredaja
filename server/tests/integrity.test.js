// ─────────────────────────────────────────────────────────────────────
// Integrity fixes (companion to promotion.test.js):
//   • REPORT_LIMITS.reportStep — at most ONE report per account per
//     (process, region, step) per 24h, so a single account can't even
//     register multiple reports against the same step.
//   • Document access — no moderator override: a moderator requesting
//     another user's document gets 403 (both the /uploads gate and the
//     serveDocument handler).
//
// Runs against an in-memory SQLite so it exercises the real DB queries.
// ─────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

const { initDb, db } = await import('../src/db.js');
const { initSchema } = await import('../src/schema.js');
const { syncProcessLibrary } = await import('../src/processes.js');
const { REPORT_LIMITS } = await import('../src/rate-limit.js');
const { requireUploadAccess } = await import('../src/uploads.js');
const { serveDocument } = await import('../src/routes/documents.js');

before(async () => {
  await initDb();
  await initSchema();
  await syncProcessLibrary();
});

after(async () => {
  await db.close();
});

// ── 1. per-(process, region, step) report rate limit ─────────────────
test('reportStep: first report on a step passes, second within 24h is rejected', () => {
  const limiter = REPORT_LIMITS.reportStep;
  const req = () => ({
    user: { id: 7001 },
    body: { process_slug: 'trade-license', region: 'addis_ababa', step_key: 'prepare-lease' },
  });
  const res = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {} };

  let nextCount = 0;
  limiter(req(), res, () => nextCount++);
  assert.equal(nextCount, 1, 'first report on a fresh step is allowed');
  assert.equal(res.statusCode, 0);

  limiter(req(), res, () => nextCount++);
  assert.equal(nextCount, 1, 'second report from the same account on the same step is blocked');
  assert.equal(res.statusCode, 429);
});

test('reportStep: different steps (same account) are independent buckets', () => {
  const limiter = REPORT_LIMITS.reportStep;
  const mk = (stepKey) => ({
    user: { id: 7002 },
    body: { process_slug: 'trade-license', region: 'addis_ababa', step_key: stepKey },
  });
  const res = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {} };

  let nextCount = 0;
  limiter(mk('prepare-lease'), res, () => nextCount++);
  limiter(mk('get-tin'), res, () => nextCount++);
  assert.equal(nextCount, 2, 'a report on one step must not block a different step');
});

test('reportStep: the same step in a different region is not blocked', () => {
  const limiter = REPORT_LIMITS.reportStep;
  const mk = (region) => ({
    user: { id: 7003 },
    body: { process_slug: 'trade-license', region, step_key: 'prepare-lease' },
  });
  const res = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {} };

  let nextCount = 0;
  limiter(mk('addis_ababa'), res, () => nextCount++);
  limiter(mk('bahir_dar'), res, () => nextCount++);
  assert.equal(nextCount, 2, 'region is part of the key');
});

// ── 2. moderator document access ─────────────────────────────────────
test('moderator requesting another user document via /uploads gets 403', async () => {
  // Owner user 7101, another user's document.
  const { lastId: docId } = await db.run(
    `INSERT INTO documents (user_id, type, file_name, file_path, file_size, mime_type, sha256, uploaded_at)
     VALUES (7101, 'address_proof', 'id.png', '/uploads/documents/7101.enc', 5, 'image/png', '', ?)`,
    [new Date().toISOString()]
  );

  // requireUploadAccess — the gate mounted at /uploads.
  const gate = requireUploadAccess();
  const modReq = { path: `/documents/${docId}.enc`, user: { id: 7102, is_moderator: 1 } };
  const res = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {} };
  let nexted = false;
  await gate(modReq, res, () => { nexted = true; });
  assert.equal(nexted, false, 'moderator must not pass the /uploads gate for another user');
  assert.equal(res.statusCode, 403);

  // serveDocument — the handler itself (belt and braces).
  const res2 = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {}, send() {} };
  await serveDocument({ params: { id: docId }, user: { id: 7102, is_moderator: 1 } }, res2);
  assert.equal(res2.statusCode, 403, 'serveDocument must deny a moderator reading another user doc');

  // Owner still passes the gate (next() called) — access control intact.
  const ownerReq = { path: `/documents/${docId}.enc`, user: { id: 7101, is_moderator: 0 } };
  const res3 = { statusCode: 0, set() {}, status(c) { this.statusCode = c; return this; }, json() {} };
  let ownerNexted = false;
  await gate(ownerReq, res3, () => { ownerNexted = true; });
  assert.equal(ownerNexted, true, 'owner must still pass the gate');
});
