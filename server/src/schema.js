// ─────────────────────────────────────────────────────────────────────
// Schema shared by SQLite and PostgreSQL.
// Convention: ISO-8601 TEXT timestamps, INTEGER booleans, JSON as TEXT.
//
// Design notes:
//   • `processes` stores the whole process definition (steps, region
//     variants, documents) as a versioned JSON blob (data_json) keyed by
//     slug + version. Content corrections are a JSON edit + re-seed, not
//     a redeploy — see README "what's real vs seeded".
//   • Step identities are stable string keys ("register-name", "tin"),
//     so a checklist keeps working when a process definition is edited.
//     checklist_step_status rows reference (user_checklist_id, step_key).
//   • Documents are encrypted at rest (AES-256-GCM via src/uploads.js);
//     file_path points at an .enc blob under /uploads/documents/.
// ─────────────────────────────────────────────────────────────────────
import { db } from './db.js';

const TABLES = (idCol) => [
  `CREATE TABLE IF NOT EXISTS users (
    id ${idCol},
    phone TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    is_moderator INTEGER DEFAULT 0,
    device_fingerprint TEXT DEFAULT '',
    signup_ip TEXT DEFAULT '',
    last_ip TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  // Server-side sessions backing the stateless JWT (Zemen pattern).
  `CREATE TABLE IF NOT EXISTS sessions (
    id ${idCol},
    user_id INTEGER NOT NULL,
    token_id TEXT UNIQUE NOT NULL,                -- the JWT's jti
    device_info TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS otp_codes (
    id ${idCol},
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT DEFAULT 'login',
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  // Versioned process library (see header comment).
  // NOTE: only UNIQUE(slug, version) — a slug-only unique column would
  // make it impossible to insert a second version of the same process,
  // which is the whole point of versioned content (edit + re-seed,
  // no redeploy).
  `CREATE TABLE IF NOT EXISTS processes (
    id ${idCol},
    slug TEXT NOT NULL,
    category TEXT NOT NULL,                       -- license | tax | name | …
    version INTEGER NOT NULL DEFAULT 1,
    data_json TEXT NOT NULL,                      -- full process definition
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(slug, version)
  )`,

  // One guided checklist instance per (user, process, region).
  `CREATE TABLE IF NOT EXISTS user_checklists (
    id ${idCol},
    user_id INTEGER NOT NULL,
    process_slug TEXT NOT NULL,
    region TEXT NOT NULL,                         -- resolved region at start
    process_version INTEGER NOT NULL,             -- snapshot of the version started
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`,

  // Per-step progress within a checklist. step_key is stable across
  // process definition edits (see header comment).
  `CREATE TABLE IF NOT EXISTS checklist_step_status (
    id ${idCol},
    user_checklist_id INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    status TEXT DEFAULT 'todo',                   -- todo | done
    note TEXT DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(user_checklist_id, step_key)
  )`,

  // Document vault. Encrypted at rest — the plaintext never touches disk.
  `CREATE TABLE IF NOT EXISTS documents (
    id ${idCol},
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,                           -- national_id | address_proof | …
    file_name TEXT DEFAULT '',
    file_path TEXT NOT NULL,                      -- /uploads/documents/<id>.enc
    file_size INTEGER DEFAULT 0,
    mime_type TEXT DEFAULT '',                    -- detected by magic bytes
    sha256 TEXT DEFAULT '',                       -- of the plaintext, for dedup
    uploaded_at TEXT NOT NULL
  )`,

  // Join table: one vault document attaches to many checklist steps.
  `CREATE TABLE IF NOT EXISTS document_attachments (
    id ${idCol},
    document_id INTEGER NOT NULL,
    user_checklist_id INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, user_checklist_id, step_key)
  )`,

  // Community reality-check reports, scoped to (process, region, step).
  // moderation_status: approved | flagged | hidden (flagged → hidden from
  // aggregates until a moderator acts; hidden → removed).
  `CREATE TABLE IF NOT EXISTS step_reports (
    id ${idCol},
    process_slug TEXT NOT NULL,
    region TEXT NOT NULL,
    step_key TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    actual_wait_estimate INTEGER,                 -- days, NULL = "no estimate"
    office_location TEXT DEFAULT '',
    requirement_waived INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    moderation_status TEXT DEFAULT 'approved',
    flagged_by INTEGER,
    created_at TEXT NOT NULL
  )`,
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_id)',
  'CREATE INDEX IF NOT EXISTS idx_checklists_user ON user_checklists(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_step_status_cl ON checklist_step_status(user_checklist_id)',
  'CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_attachments_doc ON document_attachments(document_id)',
  'CREATE INDEX IF NOT EXISTS idx_attachments_cl ON document_attachments(user_checklist_id)',
  'CREATE INDEX IF NOT EXISTS idx_reports_lookup ON step_reports(process_slug, region, step_key, moderation_status)',
];

/** Full DDL as executable statements. */
export function schemaDdl() {
  const idCol = db.dialect === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  return { tables: TABLES(idCol), indexes: INDEXES };
}

export async function initSchema() {
  const { tables, indexes } = schemaDdl();
  for (const sql of tables) await db.run(sql);
  for (const sql of indexes) await db.run(sql);
  await migrateDeletionColumn();
  await migrateProcessesUnique();
}

/** DBs created before account deletion existed need users.deleted_at. */
async function migrateDeletionColumn() {
  if (db.dialect === 'pg') {
    await db.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT');
    return;
  }
  const cols = await db.all(`SELECT name FROM pragma_table_info('users')`);
  if (!cols.some((c) => c.name === 'deleted_at')) {
    await db.run('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  }
}

/**
 * DBs created before the versioning fix had `slug TEXT UNIQUE`, which
 * forbids a second version of the same process (breaking the edit +
 * re-seed workflow). Rebuild the table without the slug-only unique
 * column, keeping UNIQUE(slug, version).
 */
async function migrateProcessesUnique() {
  if (db.dialect === 'pg') return; // pg DDL never had the slug UNIQUE column
  const row = await db.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'processes'`);
  if (!row?.sql) return;
  // Already fixed if the slug column is not declared UNIQUE inline.
  if (!/slug\s+TEXT\s+UNIQUE/i.test(row.sql)) return;
  const { tables } = schemaDdl();
  const createSql = tables.find((t) => t.startsWith('CREATE TABLE IF NOT EXISTS processes'));
  await db.run('ALTER TABLE processes RENAME TO processes_old');
  await db.run(createSql);
  await db.run(`INSERT INTO processes (id, slug, category, version, data_json, created_at, updated_at)
                SELECT id, slug, category, version, data_json, created_at, updated_at FROM processes_old`);
  await db.run('DROP TABLE processes_old');
}
