/**
 * StatsRepository — owns `user_stats`.
 *
 * Stats are the textbook race-prone table: many concurrent admins flipping
 * "attended" on the same dienst. All increments and absolute sets go through
 * RPC so the read-modify-write happens inside a single Postgres transaction
 * with row-level locking.
 */

import { getSupabase, filter } from '../supabase.js';
import { statsRowToModel, statsToRow } from '../mappers.js';
import {
  type StatField, type StatsRow, type UserStats,
  isUuid, isValidStatField
} from '../types.js';
import { badRequest } from '../errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('repo.stats');
const TABLE = 'user_stats';
const COLUMNS = 'user_id,attended,cancelled,late_cancelled';

export interface StatsRepository {
  /** Returns stats for one user, or zeros if missing. */
  getByUser(userId: string): Promise<UserStats>;
  /** Returns stats for all users, keyed by user-id. */
  listAll(): Promise<Record<string, UserStats>>;
  /**
   * Atomically apply a delta to one stat field. Negative deltas are clamped at
   * zero by the database. Use this for "attended +1", "cancelled -1", etc.
   */
  increment(userId: string, field: StatField, delta: number): Promise<UserStats>;
  /**
   * Atomically set one stat field to an absolute value (clamped at zero).
   * Use this for admin overrides.
   */
  setField(userId: string, field: StatField, value: number): Promise<UserStats>;
  /** Replaces the entire stats row for one user. */
  upsert(userId: string, stats: UserStats): Promise<void>;
  /** Hard-delete one user's stats row. */
  remove(userId: string): Promise<void>;
  /** Atomically replaces ALL stats — admin import only. */
  replaceAll(stats: Readonly<Record<string, UserStats>>): Promise<void>;
}

export function createStatsRepository(): StatsRepository {
  const sb = getSupabase();

  return {
    async getByUser(userId) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      const rows = await sb.rest.select<StatsRow>(
        TABLE, 'select=' + COLUMNS + '&' + filter.eq('user_id', userId) + '&limit=1'
      );
      return rows.length ? statsRowToModel(rows[0]) : { attended: 0, cancelled: 0, lateCancelled: 0 };
    },

    async listAll() {
      const rows = await sb.rest.select<StatsRow>(TABLE, 'select=' + COLUMNS);
      const out: Record<string, UserStats> = {};
      for (const row of rows) out[row.user_id] = statsRowToModel(row);
      return out;
    },

    async increment(userId, field, delta) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      if (!isValidStatField(field)) throw badRequest('Invalid stat field', 'invalid_input');
      const d = Number(delta);
      if (!Number.isFinite(d)) throw badRequest('Invalid delta', 'invalid_input');
      log.info('increment', { userId, field, delta: d });
      const row = await sb.rpc.call<StatsRow>('increment_user_stat', {
        p_user_id: userId,
        p_field: field,
        p_delta: Math.round(d)
      });
      return statsRowToModel(row);
    },

    async setField(userId, field, value) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      if (!isValidStatField(field)) throw badRequest('Invalid stat field', 'invalid_input');
      const v = Math.max(0, Math.round(Number(value) || 0));
      log.info('setField', { userId, field, value: v });
      const row = await sb.rpc.call<StatsRow>('set_user_stat', {
        p_user_id: userId,
        p_field: field,
        p_value: v
      });
      return statsRowToModel(row);
    },

    async upsert(userId, stats) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      log.info('upsert', { userId });
      await sb.rest.upsert<StatsRow>(TABLE, statsToRow(userId, stats), {
        onConflict: 'user_id'
      });
    },

    async remove(userId) {
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      log.info('remove', { userId });
      await sb.rest.remove(TABLE, filter.eq('user_id', userId));
    },

    async replaceAll(stats) {
      log.info('replaceAll', { count: Object.keys(stats).length });
      await sb.rpc.call('replace_stats', { p_stats: stats });
    }
  };
}
