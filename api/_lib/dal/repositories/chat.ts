/**
 * ChatRepository — owns `chat_messages`.
 *
 * Single-message writes are direct PostgREST. The multi-message replace and
 * the bounded-window read both go via dedicated paths so we never tail-fetch
 * the whole table when we only want the last 200 messages.
 */

import { getSupabase, filter } from '../supabase.js';
import { chatRowToModel, chatToRow } from '../mappers.js';
import {
  type ChatMessage, type ChatRow, type PublicUserProfile
} from '../types.js';
import { badRequest } from '../errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('repo.chat');
const TABLE = 'chat_messages';
const COLUMNS = 'message_id,author_user_id,body,system,triggered_by,created_at';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export interface ChatRepository {
  /**
   * Returns the latest `limit` messages, oldest-first (so the UI can append
   * without re-sorting). Default 200, hard cap 1000.
   */
  listLatest(
    limit?: number,
    authors?: Readonly<Record<string, PublicUserProfile>>
  ): Promise<Record<string, ChatMessage>>;
  /** Returns one message, or `null`. */
  getById(messageId: string, authors?: Readonly<Record<string, PublicUserProfile>>): Promise<ChatMessage | null>;
  /** Inserts or updates one message. */
  upsert(messageId: string, message: Partial<ChatMessage>): Promise<void>;
  /** Hard-delete one message. */
  remove(messageId: string): Promise<void>;
  /** Atomically replaces ALL chat — admin reset / import only. */
  replaceAll(messages: Readonly<Record<string, ChatMessage>>): Promise<void>;
}

export function createChatRepository(): ChatRepository {
  const sb = getSupabase();

  return {
    async listLatest(limit = DEFAULT_LIMIT, authors = {}) {
      const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || DEFAULT_LIMIT)));
      // Newest first via the DB, then reverse in JS to give oldest-first to caller.
      const rows = await sb.rest.select<ChatRow>(
        TABLE,
        'select=' + COLUMNS + '&order=created_at.desc&limit=' + lim
      );
      const out: Record<string, ChatMessage> = {};
      for (const row of rows.reverse()) out[row.message_id] = chatRowToModel(row, authors);
      return out;
    },

    async getById(messageId, authors = {}) {
      if (!messageId) return null;
      const rows = await sb.rest.select<ChatRow>(
        TABLE,
        'select=' + COLUMNS + '&' + filter.eq('message_id', messageId) + '&limit=1'
      );
      return rows.length ? chatRowToModel(rows[0], authors) : null;
    },

    async upsert(messageId, message) {
      if (!messageId) throw badRequest('Missing message id', 'invalid_input');
      log.info('upsert', { messageId });
      await sb.rest.upsert<ChatRow>(TABLE, chatToRow(messageId, message), {
        onConflict: 'message_id'
      });
    },

    async remove(messageId) {
      if (!messageId) throw badRequest('Missing message id', 'invalid_input');
      log.info('remove', { messageId });
      await sb.rest.remove(TABLE, filter.eq('message_id', messageId));
    },

    async replaceAll(messages) {
      log.info('replaceAll', { count: Object.keys(messages).length });
      await sb.rpc.call('replace_chat', { p_chat: messages });
    }
  };
}
