// ─────────────────────────────────────────────────────────────────────
// Demo seed. Creates:
//   • a demo user (moderator) with two checklist instances in progress
//   • sample community step reports so the reality-check signals render
//   • one sample vault document (a generated PNG, encrypted at rest)
//     attached to steps of two different checklists — proving the
//     upload-once / reuse-everywhere flow
//
// Safe to re-run: skips when already seeded. The process library is
// synced separately at boot (syncProcessLibrary) — `npm run seed` only
// adds demo *user data*.
//
//   npm run seed
// ─────────────────────────────────────────────────────────────────────
import { pathToFileURL } from 'node:url';
import { initDb, db } from './db.js';
import { initSchema } from './schema.js';
import { nowIso, sha256 } from './crypto.js';
import { writeEncryptedDocument } from './uploads.js';
import { syncProcessLibrary } from './processes.js';

const DAY = 86400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const DEMO_USER = { phone: '+251911000001', name: 'Demo User (Abebe)', is_moderator: 1 };

/** Minimal valid PNG bytes (1×1 transparent) for a seed document. */
function tinyPng() {
  // 1x1 transparent PNG — real magic bytes, safe to embed.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
}

export async function runSeed() {
  // ── process library ────────────────────────────────────────────────
  await syncProcessLibrary();

  const existing = await db.get('SELECT id FROM users WHERE phone = ?', [DEMO_USER.phone]);
  if (existing) {
    console.log('  Meredaja is already seeded — skipping. (Delete server/data/meredaja.db to reseed.)');
    return;
  }

  // ── demo user ──────────────────────────────────────────────────────
  const { lastId: userId } = await db.run(
    `INSERT INTO users (phone, name, is_moderator, device_fingerprint, signup_ip, last_ip, created_at)
     VALUES (?, ?, ?, 'seed', '127.0.0.1', '127.0.0.1', ?)`,
    [DEMO_USER.phone, DEMO_USER.name, DEMO_USER.is_moderator, daysAgo(30)]
  );

  // ── checklist 1: trade license (Addis Ababa), 2/5 steps done ───────
  const { lastId: cl1 } = await db.run(
    `INSERT INTO user_checklists (user_id, process_slug, region, process_version, started_at)
     VALUES (?, 'trade-license', 'addis_ababa', 1, ?)`,
    [userId, daysAgo(6)]
  );
  const mkStatus = (clId, stepKey, status, note, updatedDaysAgo) =>
    db.run(
      `INSERT INTO checklist_step_status (user_checklist_id, step_key, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [clId, stepKey, status, note, daysAgo(updatedDaysAgo)]
    );
  await mkStatus(cl1, 'register-name', 'done', 'Registered "Abebe Coffee Export" — took 2 days, fast desk.', 4);
  await mkStatus(cl1, 'get-tin', 'done', 'Got TIN same day at Bole branch.', 3);
  await mkStatus(cl1, 'prepare-lease', 'todo', '', 2);
  await mkStatus(cl1, 'submit-application', 'todo', '', 2);
  await mkStatus(cl1, 'pay-and-collect', 'todo', '', 2);

  // ── checklist 2: business name (Addis Ababa), 3/4 steps done ───────
  const { lastId: cl2 } = await db.run(
    `INSERT INTO user_checklists (user_id, process_slug, region, process_version, started_at)
     VALUES (?, 'business-name', 'addis_ababa', 1, ?)`,
    [userId, daysAgo(10)]
  );
  await mkStatus(cl2, 'check-availability', 'done', 'Name was free. Clerk suggested 2 alternatives too.', 8);
  await mkStatus(cl2, 'submit-name-application', 'done', 'Submitted Tuesday, approved Thursday.', 7);
  await mkStatus(cl2, 'pay-name-fee', 'done', 'Paid at CBE branch — receipt kept in vault.', 5);
  await mkStatus(cl2, 'collect-certificate', 'todo', 'Told to come back next week for the certificate.', 3);

  // ── sample vault document (PNG) + attachments to both checklists ───
  const png = tinyPng();
  const { lastId: docId } = await db.run(
    `INSERT INTO documents (user_id, type, file_name, file_path, file_size, mime_type, sha256, uploaded_at)
     VALUES (?, 'address_proof', 'sample-address-proof.png', '', ?, 'image/png', ?, ?)`,
    [userId, png.length, sha256(png), daysAgo(4)]
  );
  const filePath = await writeEncryptedDocument(docId, png);
  await db.run('UPDATE documents SET file_path = ? WHERE id = ?', [filePath, docId]);

  // Same document attached to a step in BOTH checklists → reuse-once-everywhere.
  await db.run(
    `INSERT INTO document_attachments (document_id, user_checklist_id, step_key, created_at)
     VALUES (?, ?, 'prepare-lease', ?)`,
    [docId, cl1, daysAgo(4)]
  );
  await db.run(
    `INSERT INTO document_attachments (document_id, user_checklist_id, step_key, created_at)
     VALUES (?, ?, 'check-availability', ?)`,
    [docId, cl2, daysAgo(4)]
  );

  // ── sample community step reports (approved) ───────────────────────
  const REPORTS = [
    // [process_slug, region, step_key, waitDays, office, waived, note, daysAgo]
    ['trade-license', 'addis_ababa', 'register-name', 2, 'Bole sub-city', 0, 'Fast — the name check desk had the registry open.', 20],
    ['trade-license', 'addis_ababa', 'register-name', 5, 'Kirkos sub-city', 0, 'Long queue, went twice. Bring 3 name alternatives.', 12],
    ['trade-license', 'addis_ababa', 'get-tin', 1, 'Bole MoR branch', 0, 'Same-day TIN for individuals.', 15],
    ['trade-license', 'addis_ababa', 'get-tin', 3, 'Central MoR branch', 0, 'Busy month — took 3 days.', 9],
    ['trade-license', 'addis_ababa', 'prepare-lease', 7, 'Notary at Addis Ketema', 0, 'Notary queue was the bottleneck.', 18],
    ['trade-license', 'addis_ababa', 'submit-application', 14, 'Yeka sub-city', 0, 'Application sat for 2 weeks; follow up in person.', 8],
    ['trade-license', 'addis_ababa', 'pay-and-collect', 3, 'Yeka sub-city', 0, 'Fee paid at CBE, license ready 3 days later.', 6],
    ['business-name', 'addis_ababa', 'check-availability', 0, 'Online registry', 0, 'Checked online from home — no office visit needed.', 25],
    ['business-name', 'addis_ababa', 'submit-name-application', 3, 'Arada sub-city', 0, 'Straightforward. Take copies of everything.', 14],
    ['business-name', 'addis_ababa', 'collect-certificate', 4, 'Arada sub-city', 0, 'Certificate took longer than promised.', 10],
    ['tin-registration', 'addis_ababa', 'visit-revenues-office', 1, 'Nifas Silk sub-city tax office', 0, 'Queue number system works well in the morning.', 22],
    ['tin-registration', 'addis_ababa', 'receive-tin', 2, 'Nifas Silk sub-city tax office', 0, 'Same-day issue for individuals, 2 days for business TIN.', 11],
  ];
  for (const [ps, region, stepKey, wait, office, waived, note, ago] of REPORTS) {
    await db.run(
      `INSERT INTO step_reports
         (process_slug, region, step_key, user_id, actual_wait_estimate, office_location, requirement_waived, note, moderation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
      [ps, region, stepKey, userId, wait, office, waived, note, daysAgo(ago)]
    );
  }

  console.log('\n  ✔ Meredaja demo data seeded.');
  console.log('\n  Demo account (OTP appears in the server console on request):');
  console.log(`    ${DEMO_USER.name}   ${DEMO_USER.phone}  (moderator)\n`);
}

async function main() {
  await initDb();
  await initSchema();
  await runSeed();
  await db.close();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
