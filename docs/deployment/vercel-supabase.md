# Vercel + Supabase Deployment

## Target Architecture

- Vercel serves the static PWA and Node.js API routes under `/api/*`.
- Supabase provides the free Postgres project and hosted Auth.
- The default deployment stays on free tiers: Vercel Hobby, Supabase Free, and
  Google/GitHub/Microsoft OAuth only.
- The browser never receives the database password or service-role key.
- All app data goes through Vercel API routes, which validate the Supabase session and role before reading or writing.
- The database schema is normalized to third normal form: roles, users,
  service events, service attendees, user stats and chat messages are stored in
  separate tables with foreign keys.
- Every app table has RLS enabled and denies direct client access.

## Required Vercel Environment Variables

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
APP_BASE_URL=https://<your-vercel-domain>
APP_OAUTH_PROVIDERS=google,github,azure
APP_ALLOWED_EMAIL_DOMAINS=
```

For this project the public Supabase values are:

```env
SUPABASE_URL=https://uvsgzvzttsohcmsnfgla.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_tIgL-ThuxWBDOcwrf6kXYQ_0_OPWmcs
```

Set all variables in Vercel Project Settings for Production and Development.
Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser; it must exist only as
a Vercel server-side environment variable.

## Supabase Setup

1. Create a Supabase project in an EU region when possible.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It uses
   `create table if not exists`, idempotent role seeds and idempotent grants, so
   it is safe to run again during deployment hardening. It also grants table
   access only to the server-side `service_role`; direct browser keys remain
   blocked by RLS/no client grant.
3. Enable Auth providers: Google, GitHub and Azure (Microsoft).
4. Add OAuth redirect URLs:
   - `https://<project-ref>.supabase.co/auth/v1/callback` in each provider console.
   - `https://<your-vercel-domain>/index.html?backend=cloud` in Supabase Auth URL configuration.
5. Create the first dev user from Supabase Auth, then add a matching profile in
   `public.app_users`.

## Normalized Tables

| Table | Purpose |
|-------|---------|
| `app_roles` | Stable role catalogue: `user`, `admin`, `dev` |
| `app_users` | One row per Supabase Auth user and role assignment |
| `service_events` | One row per planned service |
| `service_attendees` | Many-to-many relation between services and users |
| `user_stats` | One aggregate stats row per user |
| `chat_messages` | One row per chat or system message |

## Free OAuth Baseline

The frontend exposes only the providers returned by `/api/config`. Keep the
default value below for a zero-cost setup:

```env
APP_OAUTH_PROVIDERS=google,github,azure
```

| Button | Supabase provider id | Provider console callback |
|--------|----------------------|---------------------------|
| Google | `google` | `https://<project-ref>.supabase.co/auth/v1/callback` |
| GitHub | `github` | `https://<project-ref>.supabase.co/auth/v1/callback` |
| Microsoft | `azure` | `https://<project-ref>.supabase.co/auth/v1/callback` |

The app starts OAuth through `/api/auth/start`, which forwards only a validated
provider id, a same-origin redirect target and a random OAuth `state`. The
browser stores the returned Supabase session in `sessionStorage`.

Apple can be enabled with `APP_OAUTH_PROVIDERS=google,github,azure,apple`, but
only after confirming that the organization has an Apple Developer Program fee
waiver or accepts the annual paid membership. It is therefore disabled by
default.

## First Dev Profile

After creating the first user in Supabase Auth, insert the matching profile:

```sql
insert into public.app_users (
  user_id,
  username,
  email,
  display_name,
  role_id,
  must_change_password
) values (
  '<supabase-auth-user-id>',
  'dev',
  'dev@example.org',
  'Developer',
  'dev',
  false
)
on conflict (user_id) do update set
  username = excluded.username,
  email = excluded.email,
  display_name = excluded.display_name,
  role_id = excluded.role_id,
  must_change_password = excluded.must_change_password;
```

## Local Development

```bash
vercel env pull .env.local
vercel dev
```

For browser-only testing without cloud credentials, keep using:

```bash
npm run dev
# open /index.html?mock=1
```

## Deployment Health Check

After setting the Vercel variables and running the SQL schema, open:

```text
https://<your-vercel-domain>/api/health
```

Expected healthy response:

```json
{
  "ok": true,
  "configured": true,
  "schema": "ready",
  "root": "ready"
}
```

If one of the normalized tables is missing, the response uses
`schema_not_installed`; run `supabase/schema.sql` once.
If the response uses `db_permission_denied`, run `supabase/schema.sql` again so
the `service_role` GRANT statements are applied.
