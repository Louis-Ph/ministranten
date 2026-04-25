/**
 * DAL — HTTP client.
 *
 * Solves three production-grade concerns for outbound calls to Supabase:
 *
 *   1. Connection reuse. We install a single `undici` Agent at module load and
 *      register it as the global dispatcher. Every native `fetch` in this
 *      lambda invocation now goes through the same keep-alive pool.
 *
 *   2. Timeouts. Every request gets an `AbortController` whose deadline is
 *      `httpTimeoutMs`. Without this, a hung Supabase response keeps the
 *      lambda alive until Vercel's hard cap.
 *
 *   3. Retries. Transient failures (5xx, ECONNRESET, AbortError due to timeout)
 *      retry with exponential backoff up to `httpMaxRetries`. 4xx is never
 *      retried — those are deterministic.
 *
 * The module also installs the dispatcher only once across hot-invocations
 * via a module-level guard.
 */

import { getConfig } from './config.js';
import { upstreamTimeout, upstreamUnavailable, AppError } from './errors.js';
import { createLogger } from './logger.js';

const log = createLogger('dal.http');

let dispatcherInstalled = false;

/**
 * Install a shared `undici` Agent with keep-alive across all `fetch` calls
 * in this lambda. `undici` is a transitive dep of Node 24's built-in fetch,
 * but only exposed as a separate package install. We try to load it and
 * silently degrade if absent — timeouts and retries below still work.
 */
async function ensureDispatcher(): Promise<void> {
  if (dispatcherInstalled) return;
  dispatcherInstalled = true; // attempt only once per cold-start
  const cfg = getConfig();
  try {
    // Resolved at runtime so typecheck doesn't fail when undici isn't installed.
    const moduleName = 'undici';
    const undici = await import(/* @vite-ignore */ moduleName) as {
      setGlobalDispatcher: (d: unknown) => void;
      Agent: new (opts: Record<string, unknown>) => unknown;
    };
    undici.setGlobalDispatcher(new undici.Agent({
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 30_000,
      connections: cfg.httpMaxConnections,
      pipelining: 1
    }));
    log.debug('dispatcher.installed', { connections: cfg.httpMaxConnections });
  } catch (err) {
    log.warn('dispatcher.unavailable', {
      detail: 'Install `undici` for shared keep-alive. Falling back to default fetch dispatcher.',
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Override the default timeout for this single call. */
  readonly timeoutMs?: number;
  /** Override the default retry count for this single call. */
  readonly maxRetries?: number;
  /** Marker propagated to logs to correlate retries. */
  readonly correlationId?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** Parsed JSON body if the response was JSON, else `null`. */
  readonly json: unknown;
}

/**
 * Fire an HTTP request to Supabase with timeout, retry and structured errors.
 *
 * Throws `AppError` (`upstream_timeout` / `upstream_unavailable`) on transport
 * failures. HTTP 4xx/5xx responses are returned to the caller (which decides
 * whether to translate them) — except that 5xx triggers a retry pass.
 */
export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  await ensureDispatcher();
  const cfg = getConfig();
  const maxRetries = req.maxRetries ?? cfg.httpMaxRetries;
  const timeoutMs = req.timeoutMs ?? cfg.httpTimeoutMs;
  const correlationId = req.correlationId || cryptoRandomId();

  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= maxRetries) {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal
      });
      const text = await res.text();
      const json = text ? safeJson(text) : null;
      const elapsed = Date.now() - t0;

      if (res.status >= 500 && attempt < maxRetries) {
        log.warn('upstream.5xx.retry', {
          correlationId, attempt, status: res.status, elapsed
        });
        attempt += 1;
        await sleep(backoffMs(attempt));
        continue;
      }

      log.debug('upstream.complete', {
        correlationId, status: res.status, elapsed, attempt
      });
      return { status: res.status, headers: res.headers, text, json };
    } catch (err) {
      lastError = err;
      const elapsed = Date.now() - t0;
      const isAbort = isAbortError(err);
      const isNet = isNetworkError(err);
      if ((isAbort || isNet) && attempt < maxRetries) {
        log.warn('upstream.transport.retry', {
          correlationId, attempt, elapsed, kind: isAbort ? 'timeout' : 'network'
        });
        attempt += 1;
        await sleep(backoffMs(attempt));
        continue;
      }
      log.error('upstream.transport.fail', {
        correlationId, attempt, elapsed, error: err
      });
      if (isAbort) throw upstreamTimeout(`timeout=${timeoutMs}ms url=${redactUrl(req.url)}`);
      throw upstreamUnavailable(redactUrl(req.url), err);
    } finally {
      clearTimeout(timer);
    }
  }
  // Defensive — loop only exits via return or throw above.
  throw upstreamUnavailable('retries_exhausted', lastError);
}

/** Convenience wrapper that throws `AppError` on non-2xx responses. */
export async function httpRequestOk(req: HttpRequest): Promise<HttpResponse> {
  const res = await httpRequest(req);
  if (res.status >= 200 && res.status < 300) return res;
  throw httpErrorFromResponse(res, req);
}

function httpErrorFromResponse(res: HttpResponse, req: HttpRequest): AppError {
  const body = res.json as { code?: string; message?: string; details?: string } | null;
  const message = body?.message || body?.details || 'Supabase request failed.';
  const supabaseCode = body?.code || '';
  // Map known PostgREST/Postgres error codes to stable domain codes.
  if (supabaseCode === 'PGRST205') {
    return new AppError(503,
      'Schema Supabase manquant. Execute supabase/schema.sql une fois dans le SQL Editor.',
      'schema_not_installed');
  }
  if (supabaseCode === '42501') {
    return new AppError(503,
      'Permissions Supabase insuffisantes pour service_role. Re-execute supabase/schema.sql.',
      'db_permission_denied');
  }
  if (supabaseCode === '23505' || res.status === 409) {
    return new AppError(409, message, 'db_conflict', { context: { supabaseCode } });
  }
  if (supabaseCode === '23502' || supabaseCode === '23514' || supabaseCode === '23503') {
    return new AppError(400, message, 'db_constraint_violation', { context: { supabaseCode } });
  }
  if (res.status === 401 || res.status === 403) {
    return new AppError(res.status, message, 'forbidden', { context: { url: redactUrl(req.url) } });
  }
  return new AppError(res.status >= 500 ? 503 : res.status, message, 'supabase_error',
    { context: { supabaseCode, url: redactUrl(req.url) } });
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: { code?: string } }).cause;
  if (cause && typeof cause.code === 'string') {
    return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(cause.code);
  }
  return /fetch failed|network|socket/i.test(err.message);
}

function backoffMs(attempt: number): number {
  // 100ms, 250ms, 600ms, 1500ms — capped.
  const base = 100 * Math.pow(2.5, attempt - 1);
  const jitter = Math.random() * 50;
  return Math.min(2000, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redactUrl(url: string): string {
  // Strip query strings — they may carry filter values.
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx) + '?…';
}

function cryptoRandomId(): string {
  // 8 hex chars is plenty to correlate logs of one request.
  const bytes = new Uint8Array(4);
  // `globalThis.crypto` exists in Node 24 without import.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
