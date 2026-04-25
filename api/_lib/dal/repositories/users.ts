/**
 * UsersRepository — owns the `app_users` table.
 *
 * Conventions:
 *   - Reads return domain objects, never DB rows.
 *   - Single-user reads / writes use targeted PostgREST queries: NEVER fetch
 *     the full state to look up one user. The previous implementation did
 *     `getRootState()` (5 SELECTs) just to know a user's role.
 *   - Multi-row replacements go through RPC for atomicity.
 */

import { getSupabase, filter } from '../supabase.js';
import { profileToUserRow, userRowToProfile, userRowToPublic } from '../mappers.js';
import {
  type PrivateUserProfile, type PublicUserProfile, type RoleId, type UserRow,
  isUuid
} from '../types.js';
import { badRequest, notFound } from '../errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('repo.users');
const TABLE = 'app_users';
const COLUMNS = 'user_id,username,email,display_name,role_id,must_change_password,created_at';

export interface UsersRepository {
  /** Returns the role for a single user, or `null` if the user is not in `app_users`. */
  getRole(userId: string): Promise<RoleId | null>;
  /** Returns the full private profile, or `null` if missing. */
  getById(userId: string): Promise<PrivateUserProfile | null>;
  /** Returns all users, ordered by username. Use sparingly — prefer targeted reads. */
  listAll(): Promise<Array<{ uid: string; profile: PrivateUserProfile }>>;
  /** Returns the public-profile map keyed by user-id. Used by chat/services to render names. */
  listPublicProfiles(): Promise<Record<string, PublicUserProfile>>;
  /** True if a username already exists (case-insensitive). */
  usernameExists(username: string): Promise<boolean>;
  /** Insert a new user. Throws `db_conflict` if `user_id` or `username` collides. */
  insert(uid: string, profile: PrivateUserProfile): Promise<void>;
  /** Patch a single user's fields. */
  patch(uid: string, patch: Partial<{
    username: string;
    email: string;
    displayName: string;
    role: RoleId;
    mustChangePassword: boolean;
  }>): Promise<void>;
  /** Hard-delete a user from `app_users` (does NOT touch Supabase Auth). */
  remove(uid: string): Promise<void>;
}

export function createUsersRepository(): UsersRepository {
  const sb = getSupabase();

  return {
    async getRole(userId) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      const rows = await sb.rest.select<Pick<UserRow, 'role_id'>>(
        TABLE,
        'select=role_id&' + filter.eq('user_id', userId) + '&limit=1'
      );
      return rows.length ? rows[0].role_id : null;
    },

    async getById(userId) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      const rows = await sb.rest.select<UserRow>(
        TABLE,
        'select=' + COLUMNS + '&' + filter.eq('user_id', userId) + '&limit=1'
      );
      return rows.length ? userRowToProfile(rows[0]) : null;
    },

    async listAll() {
      const rows = await sb.rest.select<UserRow>(
        TABLE,
        'select=' + COLUMNS + '&order=username.asc'
      );
      return rows.map(row => ({ uid: row.user_id, profile: userRowToProfile(row) }));
    },

    async listPublicProfiles() {
      const rows = await sb.rest.select<UserRow>(
        TABLE,
        'select=user_id,username,display_name&order=username.asc'
      );
      const out: Record<string, PublicUserProfile> = {};
      for (const row of rows) out[row.user_id] = userRowToPublic(row);
      return out;
    },

    async usernameExists(username) {
      const u = String(username || '').trim().toLowerCase();
      if (!u) return false;
      const rows = await sb.rest.select<{ user_id: string }>(
        TABLE,
        'select=user_id&' + filter.eq('username', u) + '&limit=1'
      );
      return rows.length > 0;
    },

    async insert(uid, profile) {
      if (!isUuid(uid)) throw badRequest('Invalid user id', 'invalid_input');
      log.info('insert', { uid });
      await sb.rest.insert<UserRow>(TABLE, profileToUserRow(uid, profile));
    },

    async patch(uid, patch) {
      if (!isUuid(uid)) throw badRequest('Invalid user id', 'invalid_input');
      const dbPatch: Record<string, unknown> = {};
      if (typeof patch.username === 'string') dbPatch.username = patch.username.trim().toLowerCase();
      if (typeof patch.email === 'string') dbPatch.email = patch.email.trim().toLowerCase();
      if (typeof patch.displayName === 'string') dbPatch.display_name = patch.displayName.slice(0, 60);
      if (patch.role) dbPatch.role_id = patch.role;
      if (typeof patch.mustChangePassword === 'boolean') dbPatch.must_change_password = patch.mustChangePassword;
      if (!Object.keys(dbPatch).length) return;
      log.info('patch', { uid, fields: Object.keys(dbPatch) });
      await sb.rest.update<UserRow>(TABLE, filter.eq('user_id', uid), dbPatch);
    },

    async remove(uid) {
      if (!isUuid(uid)) throw badRequest('Invalid user id', 'invalid_input');
      log.info('remove', { uid });
      await sb.rest.remove(TABLE, filter.eq('user_id', uid));
    }
  };
}

/** Throws `not_found` if the role is null. Convenience for handlers that
 *  cannot proceed without a role. */
export async function requireRole(repo: UsersRepository, uid: string): Promise<RoleId> {
  const role = await repo.getRole(uid);
  if (!role) throw notFound('Utilisateur sans role.', 'not_found');
  return role;
}
