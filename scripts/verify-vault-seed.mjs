// Verify seedDemoVault(): on a seeded DB with the doc deleted, the
// function must recreate the document + attachments (worker-boot case).
process.env.DB_FILE = ':memory:';
process.env.DATABASE_URL = '';

const { initDb, db } = await import('../server/src/db.js');
const { initSchema } = await import('../server/src/schema.js');
const { runSeed, seedDemoVault } = await import('../server/src/seed.js');
const { syncProcessLibrary } = await import('../server/src/processes.js');

await initDb();
await initSchema();
await runSeed();

// ── 1. Fresh seed → doc + 2 attachments exist ───────────────────────
let doc = await db.get('SELECT * FROM documents WHERE file_name = ?', ['sample-address-proof.png']);
let attaches = await db.all('SELECT * FROM document_attachments WHERE document_id = ?', [doc.id]);
console.log('fresh seed doc:', doc ? `id=${doc.id} type=${doc.type} size=${doc.file_size} mime=${doc.mime_type} path=${doc.file_path}` : 'MISSING');
console.log('fresh seed attachments:', attaches.length, '(expect 2)');
console.log('attached steps:', attaches.map((a) => a.step_key).sort().join(', '));

// ── 2. Idempotent: calling again does nothing new ────────────────────
await seedDemoVault();
const doc2 = await db.get('SELECT * FROM documents WHERE file_name = ?', ['sample-address-proof.png']);
const attach2 = await db.all('SELECT * FROM document_attachments WHERE document_id = ?', [doc2.id]);
console.log('idempotent: same doc id?', doc2.id === doc.id, '| attachments:', attach2.length, '(expect 2)');

// ── 3. Worker-boot case: doc deleted remotely → recreates ────────────
await db.run('DELETE FROM document_attachments WHERE document_id = ?', [doc.id]);
await db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
await seedDemoVault();
const doc3 = await db.get('SELECT * FROM documents WHERE file_name = ?', ['sample-address-proof.png']);
const attach3 = await db.all('SELECT * FROM document_attachments WHERE document_id = ?', [doc3.id]);
console.log('after delete+reseed: doc id', doc3.id, '(new, != old?)', doc3.id !== doc.id, '| attachments:', attach3.length, '(expect 2)');
console.log('attached steps:', attach3.map((a) => a.step_key).sort().join(', '));

// ── 4. Encrypted file actually readable (round-trip decrypt) ─────────
const { readEncryptedDocument } = await import('../server/src/uploads.js');
const bytes = await readEncryptedDocument(doc3.file_path);
console.log('decrypted round-trip bytes:', bytes.length, '(expect 67 — the 1x1 PNG)');

// ── 5. No demo user → no-op ──────────────────────────────────────────
const before = (await db.get('SELECT COUNT(*) AS n FROM documents')).n;
await db.run("DELETE FROM users WHERE phone = '+251911000001'");
await seedDemoVault();
const after = (await db.get('SELECT COUNT(*) AS n FROM documents')).n;
console.log('no demo user → doc count unchanged:', before === after, `(${before} → ${after})`);

await db.close();
console.log('\n✔ all vault-seed checks passed');
