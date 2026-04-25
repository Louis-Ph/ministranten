/**
 * DAL — Public façade.
 *
 * Single import surface for handlers:
 *
 *   import { db, auth, errors, types } from './_lib/dal';
 *
 *   const role = await db.users.getRole(uid);
 *   await db.stats.increment(uid, 'attended', 1);
 *   if (!role) throw errors.notFound();
 *
 * The repositories are constructed lazily and cached on the module. Each
 * one is stateless and safe to share across hot-invocations.
 */

import { createUsersRepository, requireRole } from './repositories/users.js';
import { createServicesRepository } from './repositories/services.js';
import { createStatsRepository } from './repositories/stats.js';
import { createChatRepository } from './repositories/chat.js';
import { createAuthRepository } from './repositories/auth.js';
import { getConfig, isConfigured, missingConfigKeys, type DalConfig, type OauthProviderId } from './config.js';
import * as errors from './errors.js';
import * as types from './types.js';
import * as authz from './authz.js';
import { getSupabase } from './supabase.js';
import { createLogger, type Logger } from './logger.js';

let cachedDb: Db | null = null;
let cachedAuth: ReturnType<typeof createAuthRepository> | null = null;

export interface Db {
  readonly users: ReturnType<typeof createUsersRepository>;
  readonly services: ReturnType<typeof createServicesRepository>;
  readonly stats: ReturnType<typeof createStatsRepository>;
  readonly chat: ReturnType<typeof createChatRepository>;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop: keyof Db) {
    if (!cachedDb) {
      cachedDb = {
        users: createUsersRepository(),
        services: createServicesRepository(),
        stats: createStatsRepository(),
        chat: createChatRepository()
      };
    }
    return cachedDb[prop];
  }
}) as Db;

type AuthRepoType = ReturnType<typeof createAuthRepository>;

export const auth: AuthRepoType = new Proxy({} as AuthRepoType, {
  get(_target, prop: string) {
    if (!cachedAuth) cachedAuth = createAuthRepository();
    return (cachedAuth as unknown as Record<string, unknown>)[prop];
  }
});

// Re-export the helpers and types that handlers need.
export { errors, types, authz };
export { requireRole };
export { isConfigured, missingConfigKeys, getConfig };
export type { DalConfig, OauthProviderId };
export { createLogger };
export type { Logger };

/**
 * Aggregates a "root state" view for handlers that genuinely need it (admin
 * export, dev backup). Uses parallel reads where safe and DOES NOT touch
 * RPC. Per-request handlers should not use this — they have targeted reads.
 */
export async function loadRootState(): Promise<types.RootState> {
  // Sanity check — fail fast with a clean error if misconfigured.
  if (!isConfigured()) throw new errors.AppError(503, 'Cloud non configure.', 'cloud_not_configured');
  const [users, services, stats, chat] = await Promise.all([
    db.users.listAll(),
    (async () => {
      const publicProfiles = await db.users.listPublicProfiles();
      return db.services.listAll(publicProfiles);
    })(),
    db.stats.listAll(),
    (async () => {
      const publicProfiles = await db.users.listPublicProfiles();
      return db.chat.listLatest(undefined, publicProfiles);
    })()
  ]);
  const root: types.RootState = types.emptyRootState();
  for (const { uid, profile } of users) {
    root.users[uid] = profile;
    root.publicProfiles[uid] = { username: profile.username, displayName: profile.displayName };
  }
  Object.assign(root.services, services);
  Object.assign(root.stats, stats);
  Object.assign(root.chat, chat);
  return root;
}

/** Smoke check used by `/api/health`. */
export async function healthCheck(): Promise<{ ok: boolean; configured: boolean; missing: string[] }> {
  const missing = missingConfigKeys();
  if (missing.length) return { ok: false, configured: false, missing };
  // Cheapest possible probe: 1-row select on app_roles (always present after migration 0001).
  const sb = getSupabase();
  await sb.rest.select('app_roles', 'select=role_id&limit=1');
  return { ok: true, configured: true, missing: [] };
}
