// ─────────────────────────────────────────────────────────────────────
// Community confidence auto-promotion (processes.js):
//   a best_effort step with >= PROMOTION_THRESHOLD approved reports
//   resolves as `community`; official/verified steps never downgrade;
//   flagged/hidden reports don't count.
//
// Runs against an in-memory SQLite so it exercises the real DB query.
// ─────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

const { initDb, db } = await import('../src/db.js');
const { initSchema } = await import('../src/schema.js');
const { syncProcessLibrary, resolveProcessWithPromotion, resolveProcess, PROMOTION_THRESHOLD } = await import('../src/processes.js');

before(async () => {
  await initDb();
  await initSchema();
  await syncProcessLibrary();
});

after(async () => {
  await db.close();
});

async function rowFor(slug) {
  return db.get('SELECT * FROM processes WHERE slug = ? ORDER BY version DESC LIMIT 1', [slug]);
}

function addReport(processSlug, stepKey, status = 'approved') {
  return db.run(
    `INSERT INTO step_reports
       (process_slug, region, step_key, user_id, actual_wait_estimate, office_location, requirement_waived, note, moderation_status, created_at)
     VALUES (?, 'addis_ababa', ?, 999, 5, 'Test office', 0, 'test', ?, ?)`,
    [processSlug, stepKey, status, new Date().toISOString()]
  );
}

test('best_effort step below threshold stays best_effort', async () => {
  const row = await rowFor('trade-license');
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === 'prepare-lease');
  assert.equal(step.confidence, 'best_effort');
});

test('best_effort step reaches threshold and promotes to community', async () => {
  const row = await rowFor('trade-license');
  // prepare-lease is best_effort; add reports up to the threshold.
  for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
    await addReport('trade-license', 'prepare-lease');
  }
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === 'prepare-lease');
  assert.equal(step.confidence, 'community');
});

test('official step is never downgraded by reports', async () => {
  const row = await rowFor('trade-license');
  for (let i = 0; i < PROMOTION_THRESHOLD + 2; i++) {
    await addReport('trade-license', 'register-name'); // official
  }
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === 'register-name');
  assert.equal(step.confidence, 'official');
});

test('flagged and hidden reports do not count toward promotion', async () => {
  const row = await rowFor('business-name');
  const stepKey = 'pay-name-fee'; // best_effort
  for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
    await addReport('business-name', stepKey, i === 0 ? 'flagged' : 'hidden');
  }
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === stepKey);
  assert.equal(step.confidence, 'best_effort', 'only approved reports count');
});

test('promotion is region-scoped: reports in another region do not promote', async () => {
  const row = await rowFor('tin-registration');
  const stepKey = 'receive-tin'; // best_effort
  for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
    await db.run(
      `INSERT INTO step_reports
         (process_slug, region, step_key, user_id, actual_wait_estimate, office_location, requirement_waived, note, moderation_status, created_at)
       VALUES (?, 'bahir_dar', ?, 999, 5, 'Test', 0, 'test', 'approved', ?)`,
      ['tin-registration', stepKey, new Date().toISOString()]
    );
  }
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === stepKey);
  assert.equal(step.confidence, 'best_effort', 'reports from other regions must not leak in');

  // And the same step DOES promote in the region that has the reports.
  const p2 = await resolveProcessWithPromotion(row, { region: 'bahir_dar' });
  const step2 = p2.steps.find((s) => s.key === stepKey);
  assert.equal(step2.confidence, 'community');
});

test('resolveProcess (pure) is unaffected — no promotion without reports lookup', async () => {
  const row = await rowFor('trade-license');
  const p = resolveProcess(row, { region: 'addis_ababa' });
  const step = p.steps.find((s) => s.key === 'prepare-lease');
  assert.equal(step.confidence, 'best_effort');
});

// ── moderator verification ───────────────────────────────────────────

test('verification promotes any step to verified, outranking community and official', async () => {
  const row = await rowFor('trade-license');
  // prepare-lease: community (already promoted by the earlier test's reports).
  await db.run(
    `INSERT INTO step_verifications (process_slug, region, step_key, verified_by, created_at)
     VALUES ('trade-license', 'addis_ababa', 'prepare-lease', 1, ?)`,
    [new Date().toISOString()]
  );
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  assert.equal(p.steps.find((s) => s.key === 'prepare-lease').confidence, 'verified');

  // official step, never downgraded, but verification still upgrades it.
  await db.run(
    `INSERT INTO step_verifications (process_slug, region, step_key, verified_by, created_at)
     VALUES ('trade-license', 'addis_ababa', 'register-name', 1, ?)`,
    [new Date().toISOString()]
  );
  const p2 = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  assert.equal(p2.steps.find((s) => s.key === 'register-name').confidence, 'verified');
});

test('un-verifying returns the step to community', async () => {
  await db.run("DELETE FROM step_verifications WHERE process_slug = 'trade-license' AND region = 'addis_ababa' AND step_key = 'prepare-lease'");
  const row = await rowFor('trade-license');
  const p = await resolveProcessWithPromotion(row, { region: 'addis_ababa' });
  // prepare-lease still has >= threshold approved reports from earlier tests.
  assert.equal(p.steps.find((s) => s.key === 'prepare-lease').confidence, 'community');
});

test('verification is region-scoped', async () => {
  // Verified only in addis_ababa; bahir_dar stays community/static.
  const row = await rowFor('trade-license');
  const p = await resolveProcessWithPromotion(row, { region: 'bahir_dar' });
  assert.equal(p.steps.find((s) => s.key === 'register-name').confidence, 'official');
});
