# Vercel + Supabase Deployment

## Target Architecture

- Vercel serves the static PWA and Node.js API routes under `/api/*`.
- Supabase provides the free Postgres project and hosted Auth.
- The default deployment stays on free tiers: Vercel Hobby, Supabase Free, and
  Google/GitHub/Microsoft OAuth only.
- The browser never receives the database password or service-role key.
- All app data goes through Vercel API routes, which validate the Supabase session and role before reading or writing.
- The database table `public.app_state` has RLS enabled and denies direct client access.

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
   `create table if not exists` and an idempotent insert, so it is safe to run
   again during deployment hardening.
3. Enable Auth providers: Google, GitHub and Azure (Microsoft).
4. Add OAuth redirect URLs:
   - `https://<project-ref>.supabase.co/auth/v1/callback` in each provider console.
   - `https://<your-vercel-domain>/index.html?backend=cloud` in Supabase Auth URL configuration.
5. Create the first dev user from Supabase Auth, then add a matching profile in `public.app_state.data.users`.

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

## First Dev Profile Shape

```json
{
  "users": {
    "<supabase-user-id>": {
      "username": "dev",
      "email": "dev@example.org",
      "displayName": "Developer",
      "role": "dev",
      "mustChangePassword": false,
      "createdAt": 0
    }
  },
  "publicProfiles": {
    "<supabase-user-id>": {
      "username": "dev",
      "displayName": "Developer"
    }
  },
  "services": {},
  "stats": {},
  "chat": {}
}
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

If the table exists but the `main` row is missing, the API creates that root row
automatically on first healthcheck/data access. If the table itself is missing,
the response uses `schema_not_installed`; run `supabase/schema.sql` once.
