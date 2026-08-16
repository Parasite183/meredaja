// ─────────────────────────────────────────────────────────────────────
// Database access layer.
//
// SQLite by default (zero-setup local development, matching Zemen).
// PostgreSQL is activated by setting DATABASE_URL. On Cloudflare
// Workers a D1 binding named `DB` replaces both — the SQL in this
// project sticks to the common subset of all three dialects
// (parameterised queries, `?` placeholders, ISO-8601 TEXT timestamps,
// JSON-as-TEXT columns, INTEGER booleans), so switching is an env/binding
// change.
// ─────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { config, serverRoot } from './config.js';

let dialect = null;
let sqlite = null;
let pool = null;
let d1 = null;

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(serverRoot, p);
}

/** Convert `?` placeholders to Postgres `$n`. */
function toPg(sql, params) {
  let i = 0;
  const out = sql.replace(/\?/g, () => `$${++i}`);
  return [out, params];
}

export async function initDb() {
  const bindings = globalThis.__MEREDAJA_BINDINGS || {};
  if (bindings.DB) {
    // Cloudflare Workers: D1 binding present.
    dialect = 'd1';
    d1 = bindings.DB;
    return;
  }
  if (config.databaseUrl.startsWith('postgres')) {
    dialect = 'pg';
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  } else {
    dialect = 'sqlite';
    const { default: Database } = await import('better-sqlite3');
    const file = config.dbFile === ':memory:' ? ':memory:' : resolvePath(config.dbFile);
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    sqlite = new Database(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
  }
}

export const db = {
  get dialect() {
    return dialect;
  },

  /** Run a write statement. Returns `{ lastId, rowCount }`. */
  async run(sql, params = []) {
    if (dialect === 'd1') {
      const res = await d1.prepare(sql).bind(...params).run();
      return { lastId: res.meta?.last_row_id ?? null, rowCount: res.meta?.changes ?? 0 };
    }
    if (dialect === 'pg') {
      const [q, p] = toPg(sql, params);
      const r = await pool.query(q, p);
      return { lastId: r.rows[0]?.id ?? null, rowCount: r.rowCount ?? 0 };
    }
    const r = sqlite.prepare(sql).run(...params);
    return { lastId: typeof r.lastInsertRowid === 'bigint' ? Number(r.lastInsertRowid) : r.lastInsertRowid, rowCount: r.changes };
  },

  async get(sql, params = []) {
    if (dialect === 'd1') {
      return (await d1.prepare(sql).bind(...params).first()) ?? null;
    }
    if (dialect === 'pg') {
      const [q, p] = toPg(sql, params);
      const r = await pool.query(q, p);
      return r.rows[0] ?? null;
    }
    return sqlite.prepare(sql).get(...params) ?? null;
  },

  async all(sql, params = []) {
    if (dialect === 'd1') {
      const { results } = await d1.prepare(sql).bind(...params).all();
      return results;
    }
    if (dialect === 'pg') {
      const [q, p] = toPg(sql, params);
      const r = await pool.query(q, p);
      return r.rows;
    }
    return sqlite.prepare(sql).all(...params);
  },

  /** Run `fn` inside a transaction. */
  async tx(fn) {
    if (dialect === 'd1') {
      // D1 transactions are serialized per binding and every write in
      // tx() is a guarded statement; run the closure directly (same
      // model Zemen uses on D1).
      return fn();
    }
    if (dialect === 'pg') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn();
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    sqlite.exec('BEGIN');
    try {
      const out = await fn();
      sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },

  async close() {
    if (dialect === 'pg' && pool) await pool.end();
    if (dialect === 'sqlite' && sqlite) sqlite.close();
    if (dialect === 'd1') d1 = null;
  },
};
