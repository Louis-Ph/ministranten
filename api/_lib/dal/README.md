# Data Access Layer (DAL)

Couche d'accès aux données pour les fonctions Vercel serverless. Conçue pour cette stack précise : **Node 24 + Supabase Postgres via PostgREST**, sans driver `pg` ni ORM.

## Pourquoi cette DAL existe

L'audit `docs/tech-debt-acid-pool-async.md` a identifié trois classes de problèmes dans l'ancien `api/_lib/cloud.ts` :

1. **Pas d'atomicité** sur les écritures multi-table (DELETE puis INSERT en deux requêtes HTTP).
2. **Pas de robustesse réseau** (zéro timeout, zéro retry, pas de keep-alive partagé).
3. **Pas de ciblage** (chaque requête tirait le state global avant de répondre).

La DAL résout les trois en cloisonnant les responsabilités et en routant les opérations multi-statements vers des fonctions Postgres atomiques.

## Arborescence

```
api/_lib/dal/
├── config.ts              # Env typée, cachée
├── errors.ts              # AppError + helpers (badRequest, forbidden, …)
├── logger.ts              # Logger JSON structuré, ~30 lignes
├── http.ts                # fetch wrapper : timeout, retry, keep-alive undici
├── supabase.ts            # Low-level: rest / rpc / auth + filter helpers
├── types.ts               # Row types (snake_case) + domain (camelCase)
├── mappers.ts             # row ↔ domain — pures, totales
├── repositories/
│   ├── users.ts           # UsersRepository
│   ├── services.ts        # ServicesRepository (services + attendees)
│   ├── stats.ts           # StatsRepository (atomic increment via RPC)
│   ├── chat.ts            # ChatRepository
│   └── auth.ts            # AuthRepository (provisioning compensé)
├── handler.ts             # withHandler({ methods, auth, handler })
├── index.ts               # Façade : { db, auth, errors, types, … }
└── README.md
```

Plus, côté SQL :

```
supabase/migrations/0002_dal_atomic_rpc.sql
```

Ce fichier crée toutes les fonctions Postgres que la DAL appelle. **Il faut l'exécuter une fois** dans le SQL Editor Supabase avant de basculer.

## Surface publique

```ts
import { db, auth, errors, types, requireRole, loadRootState } from './_lib/dal';
import { withHandler } from './_lib/dal/handler';
```

### `db.*` — repositories

| Repo | Reads ciblées | Writes atomiques |
|------|--------------|------------------|
| `db.users` | `getRole(uid)`, `getById(uid)`, `usernameExists(name)`, `listAll()`, `listPublicProfiles()` | `insert`, `patch`, `remove` |
| `db.services` | `getById(id)`, `listAll(authors?)` | `upsert(id, svc, { replaceAttendees })` (RPC), `patchField`, `remove`, `upsertAttendee`, `removeAttendee`, `replaceAttendeesOf` (RPC), `replaceAll` (RPC) |
| `db.stats` | `getByUser(uid)`, `listAll()` | `increment(uid, field, delta)` (RPC, race-free), `setField` (RPC), `upsert`, `remove`, `replaceAll` (RPC) |
| `db.chat` | `getById(id)`, `listLatest(limit?, authors?)` | `upsert`, `remove`, `replaceAll` (RPC) |

### `auth.*` — Supabase Auth

```ts
auth.resolveSession(accessToken)         // → SessionUser
auth.signInWithPassword(email, pwd)      // → SupabaseTokenResponse
auth.refresh(refreshToken)
auth.exchangePkceCode(code, verifier)
auth.provisionWithApp({ email, password, userMetadata }, async (uid) => {
  // create app_users row here. If this throws, the Auth user is deleted.
})
auth.updatePassword(userId, newPwd)
auth.listEnabledExternalProviders()
```

### `errors.*`

`AppError`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `methodNotAllowed`, `upstreamTimeout`, `upstreamUnavailable`, `internalError`, `isAppError`. Codes typés via `ErrorCode`.

### `types.*`

Row types (`UserRow`, `ServiceRow`, …) et domain types (`PrivateUserProfile`, `Service`, `UserStats`, `ChatMessage`, `RootState`). Validateurs `isUuid`, `isValidUsername`, `isValidColor`, `isValidRole`, `isValidStatField`. Helper `roleAtLeast`.

### `withHandler` — wrap a Vercel handler

```ts
import { withHandler } from './_lib/dal/handler';
import { db, errors, requireRole } from './_lib/dal';

export default withHandler<{ id?: string }, 'required'>({
  methods: ['POST'],
  auth: 'required',
  async handler({ body, session, send }) {
    const role = await requireRole(db.users, session.id);
    if (!body.id) throw errors.badRequest('Missing id');
    await db.services.upsert(body.id, { /* ... */ }, { replaceAttendees: true });
    send.json(200, { ok: true });
  }
});
```

`withHandler` gère :
- Allowlist des méthodes (renvoie `405` + `Allow` header automatique).
- Parsing JSON du body avec cap à 256 KiB (configurable via `maxBodyBytes`).
- Résolution de session : `'none'` / `'optional'` / `'required'`.
- Mapping erreurs → JSON propre + log structuré (`AppError` → status + code, autre → 500 `internal_error`).

## Garanties

### ACID
- Toute écriture qui touche **plus d'une ligne** sur **plus d'une table** passe par une fonction Postgres dans `0002_dal_atomic_rpc.sql`. Chaque fonction tourne dans une transaction unique.
- Pas de fenêtre où une table est vide pendant un `replaceAll` : c'est `BEGIN; DELETE; INSERT; COMMIT;` côté Postgres.
- Increments concurrents sur stats : `db.stats.increment` appelle `increment_user_stat()` qui prend un row-lock implicite via `UPDATE ... RETURNING`.

### Pooling HTTP
- Un seul dispatcher `undici.Agent` est installé au premier appel HTTP, partagé par tous les `fetch` de la lambda. Keep-alive = 10 s, max connections = 32 (override via `DAL_HTTP_MAX_CONNECTIONS`).
- Pas de pool Postgres applicatif — non applicable, on parle PostgREST en HTTP. Le pool Postgres est géré côté Supabase (PgBouncer).

### Asynchronicité
- Chaque requête a un timeout `DAL_HTTP_TIMEOUT_MS` (défaut 8000 ms) via `AbortController`.
- Retry exponentiel sur 5xx et erreurs réseau (`ECONNRESET`, `ETIMEDOUT`, abort timeout) : `DAL_HTTP_MAX_RETRIES` (défaut 1).
- Les 4xx ne sont jamais retried — déterministes.
- Tous les `fetch` sortants émettent un log structuré (`upstream.complete` / `upstream.5xx.retry` / `upstream.transport.fail`) avec un correlation-id.

## Variables d'environnement

| Var | Défaut | Usage |
|-----|--------|-------|
| `SUPABASE_URL` | — | URL projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | — | Clé publique (anon) — endpoints user-context |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Clé service_role — toutes les écritures DB |
| `APP_BASE_URL` | — | URL de redirection OAuth |
| `APP_OAUTH_PROVIDERS` | `google,github,azure` | Liste virgule-séparée |
| `APP_ALLOWED_EMAIL_DOMAINS` | (vide) | Gate domaine email pour OAuth/password |
| `DAL_HTTP_TIMEOUT_MS` | `8000` | Timeout par fetch sortant |
| `DAL_HTTP_MAX_RETRIES` | `1` | Retries sur 5xx/réseau |
| `DAL_HTTP_MAX_CONNECTIONS` | `32` | Cap pool undici |
| `DAL_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Migration depuis `cloud.ts`

L'ancien `cloud.ts` reste en place — la DAL est additive. La migration peut être faite handler par handler.

Étapes recommandées :

1. **Une fois pour toutes** : exécuter `supabase/migrations/0002_dal_atomic_rpc.sql` dans le SQL Editor Supabase.
2. **Renommer** `api/data.ts` → `api/data.legacy.ts`, **renommer** `api/data.v2.ts` → `api/data.ts`. Tester en preview Vercel.
3. **Migrer `api/users.ts`** pour utiliser `auth.provisionWithApp(...)` qui gère la compensation Auth↔DB.
4. **Migrer les autres handlers** un par un (`api/health.ts` → `db.healthCheck()`, `api/auth/*.ts` → `auth.*`, `api/config.ts` → `auth.listEnabledExternalProviders()`).
5. Supprimer `cloud.ts` une fois aucun handler ne le référence plus.

## Ce que la DAL **ne fait pas** (intentionnel)

- **Pas de cache lecture**. Aucun `Map<key, value>` mémorisé entre requêtes — sur Vercel les lambdas redémarrent souvent et la cohérence est plus simple sans cache. Si besoin, ajouter un cache TTL fin (Redis / Upstash) au-dessus, pas dedans.
- **Pas de query builder** type Knex. PostgREST a sa propre syntaxe, le helper `filter.eq/in/notNull/and` couvre 95 % des cas. Le reste, on écrit la query string en clair.
- **Pas de migrations runner**. Les migrations vivent dans `supabase/migrations/*.sql` et s'appliquent via Supabase CLI ou SQL Editor — c'est l'outillage existant.
- **Pas de transactions multi-RPC orchestrées en JS**. Si plusieurs RPC doivent être atomiques ensemble, on en écrit une nouvelle qui combine. C'est volontaire : la frontière transactionnelle reste **au niveau Postgres**.

## Tests (à venir)

Squelette suggéré :

```
tests/dal/
├── http.spec.ts          # mock fetch, vérifie timeout/retry/backoff
├── mappers.spec.ts       # row ↔ domain round-trips
├── repositories/
│   ├── users.spec.ts
│   ├── stats.spec.ts     # vérifie l'appel RPC, pas le SQL
│   └── ...
└── integration/
    └── data.spec.ts      # contre une vraie DB Supabase locale (CLI)
```

L'intégration doit notamment vérifier que :
- Un `kill -9` simulé entre deux requêtes ne laisse pas la base à moitié.
- 100 incréments concurrents sur un même `stats.attended` se traduisent par exactement +100.
- Un échec dans `auth.provisionWithApp.onCreated` déclenche bien le `adminDeleteUser`.
