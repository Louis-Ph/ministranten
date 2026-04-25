#!/usr/bin/env node
/**
 * Supabase migration runner — two backends.
 *
 *   1. **Direct Postgres** (preferred when available)
 *      Set `SUPABASE_DB_URL=postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres`.
 *      Each migration runs inside a single transaction; rollback on error.
 *
 *   2. **Supabase Management API** (no DB password needed)
 *      Set `SUPABASE_ACCESS_TOKEN=sbp_…` plus either `SUPABASE_PROJECT_REF=<ref>`
 *      or `SUPABASE_URL=https://<ref>.supabase.co`. The runner POSTs each
 *      migration to `https://api.supabase.com/v1/projects/<ref>/database/query`.
 *      Each call is its own Postgres transaction by default; migrations whose
 *      body wraps `begin … commit` keep that behavior unchanged.
 *
 * Bookkeeping: `public._dal_migrations(filename, sha256, applied_at)` is used
 * the same way in both backends. A migration is identified by filename + sha256;
 * a mutated migration is refused.
 *
 *   Usage:
 *     node scripts/db/migrate.mjs              # auto-detects backend
 */

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const TRACKING_TABLE = 'public._dal_migrations';
const TRACKING_DDL = `
  create table if not exists ${TRACKING_TABLE} (
    filename    text primary key,
    sha256      text not null,
    applied_at  timestamptz not null default now()
  );
`;

main().catch(err => {
  console.error('\n[migrate] failed:', err && err.message ? err.message : err);
  if (err && err.detail) console.error('[migrate] detail:', err.detail);
  if (err && err.hint) console.error('[migrate] hint:', err.hint);
  process.exit(1);
});

async function main() {
  const files = await loadMigrationFiles();
  if (!files.length) {
    console.log('[migrate] No .sql files in supabase/migrations/. Nothing to do.');
    return;
  }

  const executor = await pickExecutor();
  console.log(`[migrate] backend: ${executor.label}`);

  await executor.exec(TRACKING_DDL);
  const applied = await executor.loadApplied();

  let appliedCount = 0;
  for (const file of files) {
    const status = await applyOne(executor, file, applied);
    if (status === 'applied') appliedCount += 1;
  }

  await executor.close();
  console.log(`\n[migrate] Done. Applied ${appliedCount} new migration(s); ${files.length - appliedCount} already up to date.`);
}

// ---------------------------------------------------------------------------
// Executor selection
// ---------------------------------------------------------------------------

async function pickExecutor() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (dbUrl) return await pgExecutor(dbUrl);

  const pat = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;
  const ref = process.env.SUPABASE_PROJECT_REF || extractRef(process.env.SUPABASE_URL || '');
  if (pat && ref) return await mgmtApiExecutor(pat, ref);

  fail([
    'No backend available. Set ONE of:',
    '',
    '  SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres',
    '',
    'OR',
    '',
    '  SUPABASE_ACCESS_TOKEN=sbp_…   (Personal Access Token)',
    '  SUPABASE_PROJECT_REF=<ref>     (or SUPABASE_URL=https://<ref>.supabase.co)',
    '',
    'Find the PAT at supabase.com → Account → Access Tokens.',
    'Find the project ref in your Supabase project URL.'
  ].join('\n'));
}

function extractRef(url) {
  const m = String(url).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Backend 1 — direct Postgres via `pg`
// ---------------------------------------------------------------------------

async function pgExecutor(connectionString) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    fail('Missing dependency `pg`. Run: npm i -D pg');
  }
  const { Client } = pg.default;
  const client = new Client({
    connectionString,
    ssl: process.env.SUPABASE_DB_INSECURE === '1'
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
    statement_timeout: 60_000,
    query_timeout: 60_000
  });
  await client.connect();

  return {
    label: 'direct Postgres (pg)',
    async exec(sql) {
      await client.query(sql);
    },
    async loadApplied() {
      const { rows } = await client.query(`select filename, sha256 from ${TRACKING_TABLE}`);
      const map = new Map();
      for (const r of rows) map.set(r.filename, r.sha256);
      return map;
    },
    async applyMigration(file) {
      await client.query('begin');
      try {
        await client.query(file.sql);
        await client.query(
          `insert into ${TRACKING_TABLE} (filename, sha256) values ($1, $2)`,
          [file.name, file.sha]
        );
        await client.query('commit');
      } catch (err) {
        try { await client.query('rollback'); } catch { /* poisoned conn */ }
        throw decorate(err, file.name);
      }
    },
    async close() {
      await client.end();
    }
  };
}

// ---------------------------------------------------------------------------
// Backend 2 — Supabase Management API
// ---------------------------------------------------------------------------

async function mgmtApiExecutor(pat, projectRef) {
  const baseUrl = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`;

  async function runSql(sql) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let res;
    try {
      res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text ? { message: text } : null; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error || body.msg)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      // Don't surface the PAT — `Error.message` should never include it.
      err.detail = body && body.code ? `code=${body.code}` : undefined;
      err.hint = body && body.hint ? body.hint : undefined;
      throw err;
    }
    return Array.isArray(body) ? body : [];
  }

  return {
    label: `Supabase Management API (project ${projectRef})`,
    async exec(sql) {
      await runSql(sql);
    },
    async loadApplied() {
      const rows = await runSql(`select filename, sha256 from ${TRACKING_TABLE}`);
      const map = new Map();
      for (const r of rows) map.set(r.filename, r.sha256);
      return map;
    },
    async applyMigration(file) {
      // The Management API runs each call in its own transaction. Migrations
      // whose body wraps `begin … commit` are executed unchanged. To keep the
      // bookkeeping insert atomic with the migration content, we send both
      // statements in a single query string.
      // Escape file.sha for SQL embedding (sha is hex, safe by construction).
      const sql = `${file.sql}\n;\ninsert into ${TRACKING_TABLE} (filename, sha256) values ('${file.name.replaceAll("'", "''")}', '${file.sha}');`;
      try {
        await runSql(sql);
      } catch (err) {
        throw decorate(err, file.name);
      }
    },
    async close() { /* nothing to release */ }
  };
}

// ---------------------------------------------------------------------------
// Migration application loop
// ---------------------------------------------------------------------------

async function loadMigrationFiles() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = entries
    .filter(e => e.isFile() && e.name.endsWith('.sql'))
    .map(e => e.name)
    .sort();
  const out = [];
  for (const name of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    out.push({ name, sql, sha });
  }
  return out;
}

async function applyOne(executor, file, applied) {
  const recorded = applied.get(file.name);
  if (recorded) {
    if (recorded === file.sha) {
      console.log(`[migrate] skip   ${file.name}`);
      return 'skipped';
    }
    fail([
      `Migration ${file.name} has drifted!`,
      `  Recorded sha256 : ${recorded}`,
      `  Current sha256  : ${file.sha}`,
      '',
      'Refusing to re-apply a mutated migration. Add a NEW migration file',
      `that supersedes it, or delete its row from ${TRACKING_TABLE} if you`,
      'really know what you are doing.'
    ].join('\n'));
  }
  console.log(`[migrate] apply  ${file.name}`);
  await executor.applyMigration(file);
  return 'applied';
}

function decorate(err, fileName) {
  if (!err) return new Error(`Unknown failure on ${fileName}`);
  err.message = `[${fileName}] ${err.message}`;
  return err;
}

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}
