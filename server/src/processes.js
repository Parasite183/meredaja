// ─────────────────────────────────────────────────────────────────────
// Process library.
//
// Process definitions live as versioned JSON files in
// server/data/processes/*.json (see README "what's real vs seeded").
// On boot (and via `npm run seed`) the loader upserts them into the
// `processes` table keyed by (slug, version) — editing a JSON file and
// re-seeding updates the library WITHOUT a redeploy, which is the whole
// point: process content will be wrong at launch and must be correctable
// cheaply.
//
// Each process JSON:
//   {
//     "slug": "trade-license",
//     "version": 1,                       // bump to publish an edit
//     "category": "license",
//     "name": { "en": ..., "am": ... },
//     "summary": { "en": ..., "am": ... },
//     "default_region": "addis_ababa",
//     "steps": [ { "key", "order", "title", "description",
//                  "responsible_office", "official_timeline",
//                  "required_documents": [ { "type", "label" } ] } ],
//     "common_rejection_reasons": [ { "en", "am" } ],
//     "regions": { "<region>": {
//         "notes": { "en", "am" },
//         "step_overrides": { "<stepKey>": { "responsible_office"?, "official_timeline"?, "description"? } },
//         "extra_steps": [ step... ],     // steps only present in this region
//         "removed_steps": [ "stepKey" ]
//     } }
//   }
//
// i18n in data: every human-readable content field is { en, am } — the
// resolver returns the requested locale, falling back to en, then to
// the other locale, then to the raw string.
// ─────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { serverRoot } from './config.js';
import { db } from './db.js';
import { nowIso } from './crypto.js';
import { notFound, badRequest } from './http.js';
// Bundled by esbuild on Workers (no disk there); plain ESM import on
// Node 24+. This is the region catalog — static data, never edited at
// runtime, so importing beats a filesystem read.
import regionsData from '../data/regions.json' with { type: 'json' };

const PROCESSES_DIR = path.join(serverRoot, 'data', 'processes');
export const KNOWN_CATEGORIES = ['license', 'tax', 'name', 'other'];

/** Load every process JSON file on disk. */
export function loadProcessFiles() {
  if (!fs.existsSync(PROCESSES_DIR)) return [];
  return fs
    .readdirSync(PROCESSES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROCESSES_DIR, f), 'utf8')));
}

/**
 * Upsert all process files into the DB (idempotent per slug+version).
 * Only writes when the version differs — a content edit bumps the
 * version in JSON and the next seed propagates it.
 */
export async function syncProcessLibrary() {
  const files = loadProcessFiles();
  let changed = 0;
  for (const p of files) {
    const existing = await db.get('SELECT version FROM processes WHERE slug = ? ORDER BY version DESC LIMIT 1', [p.slug]);
    if (existing && existing.version >= p.version) continue;
    const dataJson = JSON.stringify(p);
    await db.run(
      `INSERT INTO processes (slug, category, version, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, version) DO UPDATE SET
         category = excluded.category, data_json = excluded.data_json, updated_at = excluded.updated_at`,
      [p.slug, p.category || 'other', p.version, dataJson, nowIso(), nowIso()]
    );
    changed += 1;
  }
  return { processes: files.length, changed };
}

export async function getProcessRow(slug) {
  return db.get('SELECT * FROM processes WHERE slug = ? ORDER BY version DESC LIMIT 1', [slug]);
}

function pick(content, locale) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    if (content[locale]) return content[locale];
    if (content.en) return content.en;
    if (content.am) return content.am;
    return '';
  }
  return String(content);
}

/**
 * Resolve a step's fields, applying region overrides.
 *
 * `confidence` tells users how much to trust the content for this
 * step — the README is explicit that most content is best-effort
 * reference material, and the UI shows this as a badge. Levels:
 *   verified    — field-verified against an actual office
 *   official    — matches an official published source (proclamation,
 *                 ministry notice, gazette)
 *   community   — corroborated by multiple community reports
 *   best_effort — written from general knowledge; verify at the office
 */
const CONFIDENCE_LEVELS = ['verified', 'official', 'community', 'best_effort'];

export function isValidConfidence(c) {
  return CONFIDENCE_LEVELS.includes(c);
}

function resolveStep(step, regionDef, locale) {
  const override = regionDef?.step_overrides?.[step.key] || {};
  const confidence = isValidConfidence(step.confidence) ? step.confidence : 'best_effort';
  const out = {
    key: step.key,
    order: step.order,
    title: pick(override.title || step.title, locale),
    description: pick(override.description || step.description, locale),
    responsible_office: pick(override.responsible_office || step.responsible_office, locale),
    official_timeline: pick(override.official_timeline || step.official_timeline, locale),
    confidence,
    required_documents: (step.required_documents || []).map((d) => ({
      type: d.type,
      label: pick(d.label, locale),
    })),
  };
  return out;
}

/** Region catalog (data/regions.json, bundled at build time). */
export function regionCatalog() {
  return regionsData;
}

export function isValidRegion(region) {
  return !!regionCatalog()[region];
}

/**
 * Resolve a process row into a locale-specific, region-resolved
 * definition ready to serve. Throws notFound/badRequest for bad input.
 */
export function resolveProcess(row, { region, locale = 'en' } = {}) {
  if (!row) throw notFound('Process not found');
  const data = JSON.parse(row.data_json);

  const chosenRegion = region || data.default_region || 'addis_ababa';
  if (!isValidRegion(chosenRegion)) throw badRequest(`Unknown region "${chosenRegion}"`, 'region_unknown');

  const regionDef = data.regions?.[chosenRegion] || {};
  const removed = new Set(regionDef.removed_steps || []);

  const steps = [
    ...(data.steps || []).map((s) => resolveStep(s, regionDef, locale)),
    ...(regionDef.extra_steps || []).map((s) => resolveStep(s, regionDef, locale)),
  ]
    .filter((s) => !removed.has(s.key))
    .sort((a, b) => a.order - b.order);

  return {
    slug: data.slug,
    version: row.version,
    category: data.category || 'other',
    name: pick(data.name, locale),
    summary: pick(data.summary, locale),
    default_region: chosenRegion,
    available_regions: Object.keys(data.regions || {}).length ? Object.keys(data.regions || {}) : [chosenRegion],
    steps,
    common_rejection_reasons: (data.common_rejection_reasons || []).map((r) => pick(r, locale)),
    region_notes: pick(regionDef.notes, locale),
    updated_at: row.updated_at,
  };
}

/** Public list for the library page (no step detail). */
export async function listProcesses(locale = 'en') {
  // Latest version per slug wins the dedup, so order newest first.
  const rows = await db.all('SELECT * FROM processes ORDER BY category, version DESC, id');
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.slug)) continue; // latest version per slug
    seen.add(row.slug);
    const data = JSON.parse(row.data_json);
    out.push({
      slug: data.slug,
      version: row.version,
      category: data.category || 'other',
      name: pick(data.name, locale),
      summary: pick(data.summary, locale),
      default_region: data.default_region || 'addis_ababa',
      available_regions: Object.keys(data.regions || {}).length ? Object.keys(data.regions || {}) : [data.default_region || 'addis_ababa'],
      step_count: (data.steps || []).length,
    });
  }
  return out;
}
