// ─────────────────────────────────────────────────────────────────────
// Unit tests for the security-critical pieces:
//   • magic-byte sniffing rejects lying uploads (uploads.js)
//   • encryption at rest round-trips and is not plaintext on disk
//   • region resolution + process JSON validity (processes.js)
// ─────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffMime, encryptBytes, decryptBytes } from '../src/uploads.js';
import { loadProcessFiles, resolveProcess, isValidRegion, isValidConfidence } from '../src/processes.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('sniffMime detects real PNG bytes', () => {
  assert.equal(sniffMime(PNG), 'png');
});

test('sniffMime detects PDF magic', () => {
  assert.equal(sniffMime(Buffer.from('%PDF-1.7 fake pdf body')), 'pdf');
});

test('sniffMime rejects text masquerading as an image', () => {
  assert.equal(sniffMime(Buffer.from('this is not really an image but claims png')), null);
});

test('sniffMime rejects executables', () => {
  // MZ header (Windows executable) must not sniff as any allowed type.
  assert.equal(sniffMime(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00')), null);
});

test('sniffMime rejects empty buffers', () => {
  assert.equal(sniffMime(Buffer.alloc(0)), null);
});

test('encrypt → decrypt round-trips the exact bytes', () => {
  const enc = encryptBytes(PNG);
  assert.notEqual(enc.subarray(0, 4).toString('hex'), '89504e47', 'ciphertext must not start with PNG magic');
  assert.deepEqual(decryptBytes(enc), PNG);
});

test('two encryptions of the same file differ (fresh IV)', () => {
  const a = encryptBytes(PNG);
  const b = encryptBytes(PNG);
  assert.notEqual(a.toString('hex'), b.toString('hex'));
});

test('tampered ciphertext fails to decrypt', () => {
  const enc = encryptBytes(PNG);
  enc[40] ^= 0xff; // flip a bit in the middle
  assert.throws(() => decryptBytes(enc));
});

test('garbage ciphertext throws', () => {
  assert.throws(() => decryptBytes(Buffer.alloc(10)));
});

// ── process data validity ────────────────────────────────────────────
test('process JSON files are valid: keys unique, steps ordered, regions known', () => {
  const files = loadProcessFiles();
  assert.ok(files.length >= 3, `expected at least 3 processes, got ${files.length}`);
  for (const p of files) {
    assert.ok(p.slug && p.version >= 1, `process missing slug/version: ${p.slug}`);
    assert.ok(Array.isArray(p.steps) && p.steps.length > 0, `${p.slug} has no steps`);
    const keys = p.steps.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, `${p.slug} has duplicate step keys`);
    for (const s of p.steps) {
      assert.ok(Number.isFinite(s.order), `${p.slug}/${s.key} missing order`);
      assert.ok(s.title && s.title.en, `${p.slug}/${s.key} missing title`);
      // Every step must declare a source-confidence level.
      assert.ok(isValidConfidence(s.confidence), `${p.slug}/${s.key} missing/invalid confidence (got ${s.confidence})`);
    }
    // The resolved process must expose the confidence on every step.
    const resolved = resolveProcess({ slug: p.slug, version: p.version, data_json: JSON.stringify(p), updated_at: new Date().toISOString() }, { region: p.default_region || 'addis_ababa', locale: 'en' });
    for (const s of resolved.steps) {
      assert.ok(isValidConfidence(s.confidence), `${p.slug}/${s.key} resolved confidence missing`);
    }
    if (p.regions) {
      for (const region of Object.keys(p.regions)) {
        assert.ok(isValidRegion(region), `${p.slug} references unknown region ${region}`);
      }
    }
  }
});

test('region resolution applies step overrides', () => {
  const files = loadProcessFiles();
  const trade = files.find((p) => p.slug === 'trade-license');
  const base = resolveProcess({ slug: trade.slug, version: trade.version, data_json: JSON.stringify(trade), updated_at: new Date().toISOString() }, { region: 'addis_ababa', locale: 'en' });
  const bahir = resolveProcess({ slug: trade.slug, version: trade.version, data_json: JSON.stringify(trade), updated_at: new Date().toISOString() }, { region: 'bahir_dar', locale: 'en' });

  const baseSubmit = base.steps.find((s) => s.key === 'submit-application');
  const bahirSubmit = bahir.steps.find((s) => s.key === 'submit-application');
  assert.notEqual(baseSubmit.responsible_office, bahirSubmit.responsible_office, 'region override should change the responsible office');
});

test('region resolution rejects unknown regions', () => {
  const files = loadProcessFiles();
  const p = files[0];
  assert.throws(() => resolveProcess({ slug: p.slug, version: p.version, data_json: JSON.stringify(p), updated_at: '' }, { region: 'atlantis' }));
});
