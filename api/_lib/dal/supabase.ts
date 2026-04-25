/**
 * DAL — Low-level Supabase client.
 *
 * Three thin wrappers on top of `httpRequest`:
 *
 *   - `rest`: PostgREST CRUD on `/rest/v1/<table>`. Always uses the
 *     service_role key — RLS is "deny all to clients", we authorize at
 *     the API layer instead.
 *
 *   - `rpc`: invokes a Postgres function on `/rest/v1/rpc/<fn>`. This is
 *     the **only** place where multi-statement atomic operations live.
 *     Each RPC is a single Postgres transaction.
 *
 *   - `auth`: hits `/auth/v1/...` for password/PKCE/refresh and admin
 *     user management. Uses publishableKey for user-context calls and
 *     serviceRoleKey for admin endpoints.
 */

import { getConfig, isConfigured } from './config.js';
import { AppError, badRequest } from './errors.js';
import { httpRequest, httpRequestOk, type HttpResponse } from './http.js';

type RestPrefer = 'return=minimal' | 'return=representation' | 'resolution=merge-duplicates,return=minimal';

interface BaseRestOptions {
  /** Optional `Prefer:` header value. Default: `return=minimal`. */
  prefer?: RestPrefer;
  /** ON CONFLICT target for upserts: e.g. `'service_id'` or `'service_id,user_id'`. */
  onConflict?: string;
  correlationId?: string;
}

export interface SupabaseClient {
  readonly rest: RestClient;
  readonly rpc: RpcClient;
  readonly auth: AuthClient;
}

export interface RestClient {
  select<T>(table: string, query: string, options?: { correlationId?: string }): Promise<T[]>;
  insert<T = unknown>(table: string, rows: T | T[], options?: BaseRestOptions): Promise<void>;
  upsert<T = unknown>(table: string, rows: T | T[], options?: BaseRestOptions & { onConflict: string }): Promise<void>;
  update<T = unknown>(table: string, filter: string, patch: Partial<T>, options?: BaseRestOptions): Promise<void>;
  remove(table: string, filter: string, options?: BaseRestOptions): Promise<void>;
}

export interface RpcClient {
  /**
   * Call a Postgres function. The function MUST be defined in the schema
   * and granted to `service_role`. Body is JSON-encoded as the function's
   * argument map.
   */
  call<T = unknown>(fnName: string, args: Record<string, unknown>, options?: { correlationId?: string }): Promise<T>;
}

export interface AuthClient {
  /**
   * Validates an end-user JWT by hitting `/auth/v1/user`. Returns the user
   * payload or throws `unauthorized`.
   */
  getUserFromToken(accessToken: string): Promise<SupabaseUser>;
  /** Password sign-in. */
  signInWithPassword(email: string, password: string): Promise<SupabaseTokenResponse>;
  /** Refresh-token grant. */
  refresh(refreshToken: string): Promise<SupabaseTokenResponse>;
  /** PKCE authorization-code exchange. */
  exchangePkceCode(authCode: string, codeVerifier: string): Promise<SupabaseTokenResponse>;
  /** Admin: create a new user. Requires service_role. */
  adminCreateUser(input: AdminCreateUserInput): Promise<SupabaseUser>;
  /** Admin: update an existing user. */
  adminUpdateUser(userId: string, patch: Record<string, unknown>): Promise<void>;
  /** Admin: hard-delete a user (used for compensating actions). */
  adminDeleteUser(userId: string): Promise<void>;
  /** Read the public Auth settings (provider list). */
  getSettings(): Promise<SupabaseAuthSettings>;
}

export interface SupabaseUser {
  readonly id: string;
  readonly email?: string;
  readonly app_metadata?: Record<string, unknown>;
  readonly user_metadata?: Record<string, unknown>;
}

export interface SupabaseTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly expires_at?: number;
  readonly token_type: string;
  readonly user: SupabaseUser;
}

export interface SupabaseAuthSettings {
  readonly external?: Record<string, boolean>;
}

export interface AdminCreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly emailConfirm?: boolean;
  readonly userMetadata?: Record<string, unknown>;
}

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build(): SupabaseClient {
  return {
    rest: buildRest(),
    rpc: buildRpc(),
    auth: buildAuth()
  };
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

function buildRest(): RestClient {
  return {
    async select<T>(table: string, query: string, options): Promise<T[]> {
      assertReady();
      const cfg = getConfig();
      const res = await httpRequestOk({
        method: 'GET',
        url: cfg.supabaseUrl + '/rest/v1/' + table + '?' + query,
        headers: serviceHeaders(),
        correlationId: options?.correlationId
      });
      return Array.isArray(res.json) ? (res.json as T[]) : [];
    },

    async insert(table, rows, options): Promise<void> {
      const payload = Array.isArray(rows) ? rows : [rows];
      if (!payload.length) return;
      await writeRest('POST', table, payload, options);
    },

    async upsert(table, rows, options): Promise<void> {
      const payload = Array.isArray(rows) ? rows : [rows];
      if (!payload.length) return;
      await writeRest('POST', table, payload, {
        ...options,
        prefer: 'resolution=merge-duplicates,return=minimal',
        onConflict: options.onConflict
      });
    },

    async update(table, filter, patch, options): Promise<void> {
      if (!patch || !Object.keys(patch).length) return;
      assertReady();
      const cfg = getConfig();
      await httpRequestOk({
        method: 'PATCH',
        url: cfg.supabaseUrl + '/rest/v1/' + table + '?' + filter,
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: options?.prefer || 'return=minimal'
        },
        body: JSON.stringify(patch),
        correlationId: options?.correlationId
      });
    },

    async remove(table, filter, options): Promise<void> {
      assertReady();
      const cfg = getConfig();
      await httpRequestOk({
        method: 'DELETE',
        url: cfg.supabaseUrl + '/rest/v1/' + table + '?' + filter,
        headers: {
          ...serviceHeaders(),
          Prefer: options?.prefer || 'return=minimal'
        },
        correlationId: options?.correlationId
      });
    }
  };
}

async function writeRest(
  method: 'POST',
  table: string,
  rows: unknown[],
  options?: BaseRestOptions
): Promise<void> {
  assertReady();
  const cfg = getConfig();
  const qs = options?.onConflict ? '?on_conflict=' + encodeURIComponent(options.onConflict) : '';
  await httpRequestOk({
    method,
    url: cfg.supabaseUrl + '/rest/v1/' + table + qs,
    headers: {
      ...serviceHeaders(),
      'Content-Type': 'application/json',
      Prefer: options?.prefer || 'return=minimal'
    },
    body: JSON.stringify(rows),
    correlationId: options?.correlationId
  });
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

function buildRpc(): RpcClient {
  return {
    async call<T>(fnName: string, args: Record<string, unknown>, options): Promise<T> {
      assertReady();
      if (!/^[a-z_][a-z0-9_]*$/.test(fnName)) {
        throw badRequest('Invalid RPC name: ' + fnName);
      }
      const cfg = getConfig();
      const res = await httpRequestOk({
        method: 'POST',
        url: cfg.supabaseUrl + '/rest/v1/rpc/' + fnName,
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(args || {}),
        correlationId: options?.correlationId
      });
      return res.json as T;
    }
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function buildAuth(): AuthClient {
  return {
    async getUserFromToken(accessToken) {
      assertReady();
      const cfg = getConfig();
      const res = await httpRequest({
        method: 'GET',
        url: cfg.supabaseUrl + '/auth/v1/user',
        headers: {
          apikey: cfg.publishableKey,
          Authorization: 'Bearer ' + accessToken
        }
      });
      if (res.status !== 200 || !res.json || typeof (res.json as SupabaseUser).id !== 'string') {
        throw new AppError(401, 'Session invalide.', 'invalid_session');
      }
      return res.json as SupabaseUser;
    },

    async signInWithPassword(email, password) {
      return await postAuth('/auth/v1/token?grant_type=password',
        { email, password }, /* useService */ false);
    },

    async refresh(refreshToken) {
      return await postAuth('/auth/v1/token?grant_type=refresh_token',
        { refresh_token: refreshToken }, false);
    },

    async exchangePkceCode(authCode, codeVerifier) {
      return await postAuth('/auth/v1/token?grant_type=pkce',
        { auth_code: authCode, code_verifier: codeVerifier }, false);
    },

    async adminCreateUser(input) {
      assertReady();
      const cfg = getConfig();
      const res = await httpRequestOk({
        method: 'POST',
        url: cfg.supabaseUrl + '/auth/v1/admin/users',
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: 'Bearer ' + cfg.serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          email_confirm: input.emailConfirm !== false,
          user_metadata: input.userMetadata || {}
        })
      });
      const json = res.json as SupabaseUser;
      if (!json || typeof json.id !== 'string') {
        throw new AppError(502, 'Reponse Auth invalide.', 'supabase_error');
      }
      return json;
    },

    async adminUpdateUser(userId, patch) {
      assertReady();
      const cfg = getConfig();
      await httpRequestOk({
        method: 'PUT',
        url: cfg.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(userId),
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: 'Bearer ' + cfg.serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(patch)
      });
    },

    async adminDeleteUser(userId) {
      assertReady();
      const cfg = getConfig();
      await httpRequestOk({
        method: 'DELETE',
        url: cfg.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(userId),
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: 'Bearer ' + cfg.serviceRoleKey
        }
      });
    },

    async getSettings() {
      assertReady();
      const cfg = getConfig();
      const res = await httpRequest({
        method: 'GET',
        url: cfg.supabaseUrl + '/auth/v1/settings',
        headers: { apikey: cfg.publishableKey }
      });
      if (res.status !== 200) return {} as SupabaseAuthSettings;
      return (res.json as SupabaseAuthSettings) || {};
    }
  };
}

async function postAuth(
  path: string,
  body: Record<string, unknown>,
  useService: boolean
): Promise<SupabaseTokenResponse> {
  assertReady();
  const cfg = getConfig();
  const key = useService ? cfg.serviceRoleKey : cfg.publishableKey;
  const res = await httpRequest({
    method: 'POST',
    url: cfg.supabaseUrl + path,
    headers: {
      apikey: key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (res.status !== 200 || !res.json) {
    const data = (res.json || {}) as { error_description?: string; msg?: string; error?: string };
    const msg = data.error_description || data.msg || data.error || 'Auth failed.';
    throw new AppError(res.status || 502, msg, 'supabase_error');
  }
  return res.json as SupabaseTokenResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serviceHeaders(): Record<string, string> {
  const cfg = getConfig();
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: 'Bearer ' + cfg.serviceRoleKey
  };
}

function assertReady(): void {
  if (!isConfigured()) {
    throw new AppError(503, 'Cloud non configure.', 'cloud_not_configured');
  }
}

/**
 * PostgREST filter helpers — concise URL builders that escape user input.
 */
export const filter = {
  eq(column: string, value: string | number): string {
    return encodeURIComponent(column) + '=eq.' + encodeURIComponent(String(value));
  },
  in(column: string, values: readonly (string | number)[]): string {
    const list = values.map(v => encodeURIComponent(String(v))).join(',');
    return encodeURIComponent(column) + '=in.(' + list + ')';
  },
  notNull(column: string): string {
    return encodeURIComponent(column) + '=not.is.null';
  },
  and(...parts: string[]): string {
    return parts.filter(Boolean).join('&');
  }
};
