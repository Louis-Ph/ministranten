# Audit tech-debt — ACID, pooling DB, asynchronicité web

**Périmètre** : `api/` (Vercel serverless functions Node 24) + `index.html` (front PWA) + `supabase/schema.sql`.
**Date** : 2026-04-25
**Stack constatée** : pas d'ORM, pas de driver `pg`, pas de `@supabase/supabase-js`. Toutes les "requêtes DB" sont des appels HTTP `fetch` vers PostgREST de Supabase (`/rest/v1/<table>`) et vers Supabase Auth (`/auth/v1/...`). Le pool Postgres n'est donc pas géré côté Node : c'est PgBouncer + PostgREST côté Supabase qui tiennent le pool.

Cette particularité change radicalement le sens de "transactions ACID" et "pooling" : le runtime applicatif n'a aucune transaction du tout, parce qu'il ne parle jamais à Postgres directement. Chaque écriture multi-table est une suite d'appels HTTP indépendants, donc **non atomique par construction**.

---

## Synthèse exécutive

| # | Sujet | Sévérité | Type |
|---|-------|----------|------|
| 1 | `replaceServices` / `replaceStats` / `replaceChat` font DELETE puis INSERT sans transaction → fenêtre de données vides visibles par les lecteurs concurrents | **Critique** | Architecture / ACID |
| 2 | `saveRootState` enchaîne 4 lots d'écritures séquentielles, aucune atomicité, échec partiel possible | **Critique** | Architecture / ACID |
| 3 | `users.ts` crée le user Supabase Auth puis sauvegarde le root entier — orphans en cas d'échec | **Élevée** | ACID |
| 4 | Increment de stats via read-modify-write sans CAS / version → perte d'updates concurrentes | **Élevée** | ACID / Concurrence |
| 5 | Aucun `AbortController` / timeout sur les `fetch` côté API et front | **Élevée** | Async / robustesse |
| 6 | `getRootState` (5 SELECT complets) est appelé sur **chaque** requête `/api/data` y compris les écritures, parfois deux fois | **Élevée** | Performance / async |
| 7 | Front polling `setInterval(4000)` pour simuler des subscriptions au lieu de Supabase Realtime | **Moyenne** | Async / coût |
| 8 | Aucun `keep-alive` / dispatcher undici partagé pour les fetch sortants vers Supabase | **Moyenne** | Pooling HTTP |
| 9 | Front "transaction" (`ref.transaction`) est un read+set non atomique trompeur | **Moyenne** | ACID / API design |
| 10 | `requireUser` re-valide le JWT par `fetch /auth/v1/user` à chaque appel — pas de cache local | **Moyenne** | Performance / async |
| 11 | RLS active mais policies "deny all" → toutes les écritures passent par `service_role` côté serveur, perdant le bénéfice des policies fines | **Faible** | Architecture / sécurité défensive |
| 12 | `push()` côté front lance un `set()` sans `await`, erreurs avalées par `console.warn` | **Faible** | Async / UX |

---

## 1. Garantie ACID — état des lieux

### 1.1 Aucune transaction Postgres côté applicatif
`api/_lib/cloud.ts` n'utilise **que** `fetch` vers PostgREST. Or PostgREST exécute chaque requête HTTP dans **sa propre transaction implicite**, courte. Il n'existe aucun moyen de chaîner plusieurs requêtes HTTP dans une même transaction Postgres sauf à passer par une fonction Postgres (RPC `/rest/v1/rpc/<fn>`) qui encapsule tout dans son corps `BEGIN/COMMIT`.

Conséquence : dès qu'une opération métier touche **plus d'une table** ou **plus d'une ligne d'une même table par appels successifs**, il n'y a **ni atomicité, ni isolation** garanties au niveau métier.

### 1.2 Anti-pattern "delete-then-insert" (cloud.ts:455-483)

```ts
async function replaceServices(services) {
  await deleteRows(REST_TABLES.ATTENDEES, 'service_id=not.is.null');   // 1
  await deleteRows(REST_TABLES.SERVICES, 'service_id=not.is.null');    // 2
  // ⚠️ ENTRE 2 ET 3 : la table est totalement vide
  if (serviceRows.length) await upsertRows(REST_TABLES.SERVICES, ...); // 3
  if (attendeeRows.length) await upsertRows(REST_TABLES.ATTENDEES, ...); // 4
}
```

Le même pattern existe dans `replaceStats` (ligne 471) et `replaceChat` (ligne 479).

**Risques concrets** :
- Si la lambda crash/timeout entre l'étape 2 et 3 → planning de service intégralement perdu.
- Tout `getRootState` concurrent renvoie `services: {}`. Le front affiche temporairement "aucun service".
- L'historique de chat est intégralement supprimé puis re-créé à chaque "replaceChat" — le `created_at` du schéma est conservé via le payload mais il y a une fenêtre où le chat est vide pour tous les lecteurs.

**Remédiation** : pour ce genre d'opérations, créer **une fonction Postgres** côté Supabase qui prend un `jsonb` et fait l'`upsert` + `delete` à l'intérieur d'un seul `BEGIN/COMMIT`. L'appeler ensuite via `POST /rest/v1/rpc/replace_services`. Le `schema.sql` ligne 92+ contient déjà un bloc `do $$` similaire pour la migration initiale — c'est exactement la forme à adopter.

### 1.3 `saveRootState` — quatre coups de marteau séquentiels (cloud.ts:485-494)

```ts
async function saveRootState(root) {
  if (users.length) await upsertRows(REST_TABLES.USERS, ...);
  await replaceStats(state.stats || {});
  await replaceServices(state.services || {});  // déjà non-atomique en interne
  await replaceChat(state.chat || {});
}
```

Si la lambda meurt après `replaceStats` mais avant `replaceServices`, **les stats reflètent le nouveau monde, le planning reflète l'ancien**. Pour un import de backup ou un reset admin (route `/users` puis pathSet), c'est un état incohérent permanent.

**Remédiation** : exposer **une seule** RPC `replace_root_state(p_root jsonb)` qui fait tout dans un `BEGIN/COMMIT`. Ça réduit aussi le nombre d'aller-retours HTTP de 4-N à 1.

### 1.4 `users.ts` — orphan Auth + orphan état (api/users.ts:55-81)

```ts
const created = await supabaseFetch('/auth/v1/admin/users', { ... }); // 1. user créé dans Supabase Auth
// ... pathSet en mémoire ...
await saveRootState(root);                                            // 2. réécriture complète, non atomique
```

Si l'étape 2 échoue partiellement, on a un user Supabase Auth qui peut se logger mais n'a pas de ligne `app_users`, ou pire un `app_users` partiel + `replaceStats` qui a wipé les stats globales.

**Remédiation** :
1. Faire l'`INSERT app_users` ciblé (pas un `saveRootState` complet) — seulement les colonnes nécessaires, en RPC atomique avec rollback.
2. Si l'INSERT échoue, supprimer le user Supabase Auth via `DELETE /auth/v1/admin/users/{id}` (compensation).

### 1.5 Read-modify-write sans CAS — perte d'incréments (cloud.ts:583-592)

```ts
if (root === 'stats') {
  // ...
  const state = await getRootState();                                  // lecture
  const current = Object.assign({...}, state.stats[id] || {});
  current[field] = Math.max(0, Number(value) || 0);                    // mutation locale
  await upsertRows(REST_TABLES.STATS, statsRow(id, current), 'user_id'); // écriture
  return;
}
```

Deux requêtes concurrentes "incrémente attended" lisent la même valeur, ré-écrivent la même valeur+1 → **un increment perdu**. Idem pour `cancelled` et `lateCancelled`. C'est invisible en charge faible, mais ça apparaîtra dès qu'un admin clique vite ou qu'une logique côté client envoie plusieurs PATCH proches.

**Remédiation** : exposer une RPC SQL atomique `increment_stat(p_user uuid, p_field text, p_delta int)` qui fait `UPDATE user_stats SET attended = attended + $delta WHERE user_id = $user RETURNING attended`. PostgREST l'expose en `POST /rest/v1/rpc/increment_stat`.

### 1.6 Faux `transaction()` côté front (index.html:1364-1369)

```js
async transaction(fn) {
  const snap = await this.once();
  const next = fn(snap.val());
  await this.set(next);
  return { committed: true, snapshot: ... };
}
```

Cette API mime la `transaction()` Firebase mais sans verrouillage optimiste : `committed: true` est toujours vrai, sans aucune garantie que `set` n'écrase pas une mise à jour concurrente. C'est trompeur (un dev qui lit le code croit avoir une vraie transaction).

**Remédiation a minima** : renommer en `readModifyWrite()` pour ne pas mentir. Vraie remédiation : ajouter un en-tête `If-Match` PostgREST sur la version du root (colonne `version int`) et boucler sur 409.

---

## 2. Pooling — état des lieux

### 2.1 Pas de pool Postgres côté Node (par construction)
Comme tout passe par PostgREST en HTTP, il n'y a aucun pool `pg` à configurer côté API. Le pool est géré par Supabase :
- **PgBouncer** en `transaction` mode pour les connexions PostgREST → Postgres.
- **PostgREST** mutualise la connexion sortie pgbouncer.
Sur free tier Supabase, la limite PgBouncer est ~60 connexions partagées. Comme chaque lambda Vercel fait des requêtes HTTP sans connexion persistante côté Node, on ne peut pas saturer pgbouncer trivialement, mais on peut saturer la quota PostgREST si beaucoup de lambdas tirent en parallèle.

**Action** : non bloquante — surveiller `Database > Connection Pooling` dans la console Supabase. Si le projet grossit, considérer le mode `Session pool` ou passer à `@supabase/supabase-js` côté serveur (qui mutualise plus intelligemment).

### 2.2 Pas de keep-alive / dispatcher partagé
Aucune configuration de l'agent `undici` global :
```bash
$ grep -rn "keepAlive\|setGlobalDispatcher\|undici.Agent" api/
# (vide)
```

Node 24 utilise `undici` pour `fetch` et garde une connexion HTTP/1.1 keep-alive par défaut **dans la même invocation de lambda**. Mais à chaque cold-start, on rouvre TLS. Et dans une seule invocation, `getRootState` fait 5 fetch en parallèle sans dispatcher tuné — la valeur par défaut de `connections: 10` peut suffire mais n'est pas explicite.

**Remédiation** : créer `api/_lib/http.ts` avec un dispatcher partagé :

```ts
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 30_000,
  connections: 32,
  pipelining: 1
}));
```

Importer ce module en haut de chaque handler garantit que les connexions persistent dans la même lambda chaude.

### 2.3 Multiplication artificielle des requêtes (cloud.ts:414-453)
`getRootState` fait 5 SELECT en parallèle (bien) mais **sur chaque requête `/api/data`**, y compris GET d'un sous-chemin précis. Pour un `GET /api/data?path=/services/abc`, on tire users + services + attendees + stats + chat puis on filtre en mémoire. Avec un volume de chat qui croît, ça devient coûteux.

**Remédiation** : router selon le `path` demandé pour ne SELECTer que ce qui est nécessaire. Garder `getRootState` uniquement pour les opérations admin et les writes qui doivent valider plusieurs sections.

---

## 3. Asynchronicité — état des lieux

### 3.1 Aucun timeout (api + front)
Recherche exhaustive : zéro `AbortController`, zéro `AbortSignal`, zéro `signal:` dans tout le repo.

```bash
$ grep -rn "AbortController\|AbortSignal\|signal:" api/ index.html
# (vide)
```

**Conséquence** : si Supabase rame ou répond très lentement, la lambda reste bloquée jusqu'au `maxDuration` Vercel (10s sur Hobby, 60s sur Pro). Le client front voit un spinner jusqu'au timeout natif du navigateur. Aucun message d'erreur propre, et la facture Vercel grimpe.

**Remédiation** : centraliser dans `supabaseFetch` :

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8000);
try {
  const res = await fetch(url, { ...options, signal: controller.signal });
  // ...
} finally {
  clearTimeout(timer);
}
```

Côté front, idem dans `cloudRequest`.

### 3.2 Aucun retry sur 5xx / réseau transitoire
Une 502 sporadique (cold-start Supabase) remonte directement en erreur utilisateur. Ajouter un retry exponentiel (1 retry ~250 ms) dans `supabaseFetch` pour `5xx` et `ECONNRESET` couvre 90 % des bruits.

### 3.3 Polling 4 s côté front (index.html:1351-1361)
```js
on(_evt, cb) {
  const tick = async () => { ... };
  tick();
  const timer = setInterval(tick, 4000);
}
```

Chaque ref abonné re-fetch l'API toutes les 4 s. Pour le chat, c'est à la fois trop lent (UX) et trop coûteux (chaque tick fait `getRootState` côté API → 5 SELECT). Avec N utilisateurs en ligne, c'est O(N) requêtes/4s × 5 SELECT × 6 routes data simultanées.

**Remédiation phasée** :
- **Court terme** : passer à 15 s en arrière-plan + visibilitychange pour pause quand l'onglet n'est pas visible.
- **Moyen terme** : Supabase Realtime (`@supabase/supabase-js` côté front) — gratuit jusqu'à 200 connexions concurrentes sur free tier, push natif sur INSERT/UPDATE/DELETE. Ça supprime aussi 80 % du trafic API.

### 3.4 Re-validation JWT à chaque requête (cloud.ts:390-401)
`requireUser` fait un `fetch /auth/v1/user` **à chaque appel** d'API authentifié. C'est sûr (Supabase peut révoquer la session), mais c'est aussi un round-trip réseau supplémentaire systématique.

**Remédiation** : décoder localement le JWT (vérifier la signature avec la clé publique Supabase, le `exp`, le `aud`) — `jose` fait ça en ~5 lignes. Tomber sur l'appel `/auth/v1/user` seulement si la signature ou le `exp` échoue. Coût : 10-30 ms gagnés par requête authentifiée.

### 3.5 `push()` non `await` (index.html:1344-1350)
```js
push(value) {
  // ...
  if (value !== undefined) child.set(value).catch(err => console.warn('cloud push', err));
  return child;
}
```

L'erreur d'écriture est avalée en `console.warn`. Si le réseau lâche, l'utilisateur voit un message ajouté dans l'UI (optimistique) qui n'arrivera jamais en base. Pas de toast, pas de rollback UI.

**Remédiation** : remonter l'erreur via le retour de promesse (`return child.set(...)`) ou via un événement écouté par l'UI pour afficher un toast.

### 3.6 `data.ts` — `getRootState` puis `writeDataPath` séquentiels (api/data.ts:21-46)

```ts
const user = await requireUser(req);          // 1 fetch auth
const root = await getRootState();            // 5 fetch SELECT
// ...
await writeDataPath(path, value);             // N fetch (DELETE + UPSERT)
```

Sur un PUT, c'est 1 + 5 + N. Le `getRootState` est nécessaire **uniquement** pour `roleFor(root, user.id)` et la `mergePlain` du PATCH. Les rôles peuvent venir d'un seul SELECT ciblé sur `app_users` filtré par `user_id`.

**Remédiation** : `roleFor(uid)` → `SELECT role_id FROM app_users WHERE user_id = $1` (une requête au lieu de cinq). Le `mergePlain` du PATCH peut être effectué côté Postgres via une RPC `patch_path(p_path text, p_value jsonb)`.

---

## 4. Priorisation (Impact + Risque) × (6 - Effort)

Échelle 1-5 par axe.

| # | Item | Impact | Risque | Effort | Score | Phase |
|---|------|--------|--------|--------|-------|-------|
| 1 | Atomicité `replaceServices/Stats/Chat` (RPC SQL) | 5 | 5 | 3 | 30 | P1 |
| 2 | Atomicité `saveRootState` (RPC `replace_root_state`) | 5 | 5 | 3 | 30 | P1 |
| 4 | RPC `increment_stat` (race conditions) | 4 | 5 | 2 | 36 | P1 |
| 5 | Timeouts via `AbortController` partout | 4 | 4 | 1 | 40 | P1 |
| 6 | `roleFor` ciblé au lieu de `getRootState` complet | 5 | 3 | 2 | 32 | P1 |
| 3 | Compensation orphan Auth dans `users.ts` | 3 | 4 | 2 | 28 | P2 |
| 8 | Dispatcher undici partagé (keep-alive) | 3 | 3 | 1 | 30 | P2 |
| 7 | Polling → Supabase Realtime (chat d'abord) | 4 | 2 | 4 | 12 | P3 |
| 10 | JWT verify local (jose) | 3 | 2 | 2 | 20 | P3 |
| 9 | Renommer `transaction()` ou ajouter version CAS | 2 | 3 | 2 | 20 | P3 |
| 12 | `push()` remonter l'erreur à l'UI | 2 | 2 | 1 | 20 | P3 |
| 11 | Revoir RLS — fines-grained policies | 2 | 2 | 4 | 8 | P4 |

> Effort : 1 = quelques heures, 5 = chantier > 1 semaine. Les RPC SQL pèsent surtout pour la rédaction et la migration testée.

---

## 5. Plan de remédiation phasé (compatible feature work)

### Phase 1 — sprint 1 (urgences ACID + robustesse de base)
1. **`api/_lib/http.ts`** : créer un wrapper `withTimeout(fetch, 8000)` + retry exponentiel ×1 sur 5xx. Substitution dans `supabaseFetch`, `requireUser`, `config.ts/readSupabaseProviderState`, `auth/*.ts`. (~½ jour)
2. **Schema migration** : ajouter dans `supabase/schema.sql` les fonctions PL/pgSQL :
   - `replace_services(p_services jsonb)`
   - `replace_stats(p_stats jsonb)`
   - `replace_chat(p_chat jsonb)`
   - `replace_root_state(p_root jsonb)`
   - `increment_stat(p_user uuid, p_field text, p_delta int)`
   Toutes en `SECURITY DEFINER`, `volatile`, granted to `service_role`. (~1-2 jours, tests inclus)
3. Réécrire `cloud.ts` : `replaceServices/Stats/Chat`, `saveRootState`, et la branche `stats` de `writeDataPath` → appellent les RPC ci-dessus via `POST /rest/v1/rpc/<fn>`. (~½ jour)
4. **`roleFor` ciblé** : `SELECT role_id FROM app_users WHERE user_id = $1` au lieu de tirer 5 tables. (~1 h)

**Critère de sortie phase 1** : un `kill -9` aléatoire dans la lambda pendant un import ne laisse plus la base à moitié écrite ; tests de charge sur increment de stats sans perte.

### Phase 2 — sprint 2 (compensation & pooling)
5. Compensation orphan dans `users.ts` : si l'INSERT échoue après `auth/v1/admin/users`, `DELETE /auth/v1/admin/users/{id}`. (~½ jour)
6. Dispatcher undici partagé dans `_lib/http.ts`. (~1 h)
7. Surveillance : ajouter logs structurés (durée par fetch, code retour) pour quantifier les gains avant phase 3.

### Phase 3 — sprint 3-4 (UX & coût)
8. Migration polling chat → Supabase Realtime côté front (`@supabase/supabase-js` ou WebSocket direct). Garder le polling pour les autres refs en attendant. (~2-3 jours)
9. JWT local-verify avec `jose`. (~½ jour)
10. Renommer/redocumenter `transaction()` côté front, ajouter version CAS si on garde l'API.

### Phase 4 — quand le projet aura grossi
11. Revoir RLS et les policies pour autoriser un accès direct au front via la clé `anon` sur les chemins read-only (publicProfiles, services courants), réservant `service_role` aux opérations admin. Ça permettra de transformer une partie des routes API serverless en lectures directes Supabase, divisant encore le trafic.

---

## 6. Justification métier

- **Phase 1 = mission-critical** : les patterns "delete-then-insert non transactionnel" et "read-modify-write sans CAS" sont des bombes à retardement. Un plantage Vercel pendant un import admin peut détruire le planning des dienstplan publié, avec impact direct sur la communauté paroissiale qui s'en sert. Les timeouts évitent les bills inattendus et les expériences utilisateur "spinner infini".
- **Phase 2 = hygiène** : empêche les régressions silencieuses, facilite le diagnostic.
- **Phase 3 = différenciation produit** : passer en Realtime améliore visiblement le chat et divise le coût par 5-10×.
- **Phase 4 = optimisation** : seulement si le trafic justifie d'aller chercher quelques dizaines de ms par requête.

---

## 7. Points hors scope mais à noter pour plus tard

- `vitest.config.js`, `playwright.config.js` existent — il y a une infra de test. Toutes les remédiations ACID **doivent** s'appuyer sur des tests d'intégration qui simulent un kill au milieu d'une opération multi-table. À écrire avant les RPC.
- `dist/`, `.vercel/`, `playwright-report/` sont commités (visibles au `ls`). Confirmer qu'ils sont bien dans `.gitignore` ou que c'est intentionnel.
- Le schéma définit RLS + policies "deny all" puis fait toutes les écritures via `service_role` qui bypasse RLS. Sécurité défensive valable, mais perd l'intérêt principal de RLS (vérification au niveau ligne avec le JWT du user). C'est un choix architectural, pas un bug — à challenger si on veut un jour des lectures directes depuis le front sans passer par `/api/data`.
