# Supabase — schema & migrations

## Layout

```
supabase/
├── schema.sql                       # bootstrap one-shot (legacy entry point)
├── migrations/
│   └── 0002_dal_atomic_rpc.sql      # incremental — RPC functions for the DAL
└── README.md
```

- `schema.sql` is the original bootstrap that creates tables, RLS policies and grants. It's idempotent (`create table if not exists`, etc.) and is run **once** in the Supabase SQL Editor when the project is set up.
- `migrations/*.sql` are incremental, applied by `npm run db:migrate`. Order is determined by lexicographic sort — name new migrations `NNNN_description.sql` (zero-padded, e.g. `0003_add_audit_log.sql`).

## Applying migrations — one-shot procedure

The DAL ships with `supabase/migrations/0002_dal_atomic_rpc.sql`, which adds the atomic RPC functions (`replace_root_state`, `increment_user_stat`, etc.) the new repositories rely on.

### 1. Get the Postgres connection string

Service-role key cannot run DDL. We need a direct Postgres connection.

1. Open the Supabase Dashboard for your project.
2. Project Settings → Database → **Connection string** → tab **URI**.
3. Copy the value. It looks like:
   ```
   postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
   ```

Add it to `~/.zshrc.secret` next to `SUPABASE_SERVICE_ROLE_KEY`:

```bash
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
```

Then `source ~/.zshrc.secret` (or open a new terminal).

> **Tip:** Supabase offers two pool URLs — direct (`db.<ref>.supabase.co:5432`) and the pooler (`aws-0-eu-…pooler.supabase.com:6543`). Use the **direct** connection for migrations: the pooler runs in transaction-mode and rejects some DDL. The pooler is fine for application traffic.

### 2. Install the migration runner's dependency

The runner uses [`pg`](https://www.npmjs.com/package/pg) (a tiny native Postgres client). It is declared as a `devDependency` in `package.json`:

```bash
npm install
```

### 3. Run

```bash
npm run db:migrate
```

Output looks like:

```
[migrate] apply  0002_dal_atomic_rpc.sql

[migrate] Done. Applied 1 new migration(s); 0 already up to date.
```

Subsequent runs are no-ops:

```
[migrate] skip   0002_dal_atomic_rpc.sql

[migrate] Done. Applied 0 new migration(s); 1 already up to date.
```

## How the runner works

`scripts/db/migrate.mjs`:

- Connects to Postgres directly via `pg` (TLS enforced — set `SUPABASE_DB_INSECURE=1` only for ngrok-style proxies).
- Creates `public._dal_migrations(filename text primary key, sha256 text, applied_at timestamptz)` on first run.
- For each `*.sql` file in `migrations/`, sorted lexicographically:
  - If the filename is **already recorded**, compares the file's sha256 to the stored one. Same → skip. Different → **stops with an error** so a mutated migration cannot be silently re-applied.
  - If the filename is **not recorded**, executes the file inside a single transaction (`begin` … `commit`). On error: rollback, the migration stays unrecorded, the run aborts.
- Each migration runs with `statement_timeout=60s` and `query_timeout=60s`.

## Conventions for new migrations

- One change per migration. Smaller is better.
- Filenames: `NNNN_short_description.sql`, four-digit zero-padded number, lowercase + underscores.
- Always idempotent if possible (`create … if not exists`, `create or replace function …`, `insert … on conflict do nothing`).
- A migration **must** be wrapped in a single explicit `begin; … commit;` only if it sets session state (`set search_path`, `lock table` etc.). Otherwise the runner already wraps each file. Avoid mixing both — if you keep your own `begin; commit;`, the runner's outer transaction is suppressed by Postgres and you lose the safety net.
- Once committed to the repo and applied to any environment, **never edit a migration**. Add a new one that supersedes it. The runner refuses to re-apply a file whose sha256 changed, on purpose.

## Where to find what

| What | Where |
|------|-------|
| Schema bootstrap (tables, RLS, grants) | `supabase/schema.sql` |
| RPC functions used by the DAL | `supabase/migrations/0002_dal_atomic_rpc.sql` |
| DAL source | `api/_lib/dal/` |
| Migration runner | `scripts/db/migrate.mjs` |
| `db:migrate` npm script | `package.json` |
