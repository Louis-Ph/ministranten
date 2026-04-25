/**
 * DAL — Vercel handler helpers.
 *
 * Wraps a Vercel-style `(req, res) => Promise<void>` handler with the
 * boilerplate that every endpoint needs:
 *
 *   - Method allowlist with proper `Allow` header.
 *   - JSON body parsing with size cap.
 *   - Authenticated session resolution (optional).
 *   - Centralized error mapping: every throw becomes a clean JSON response
 *     and a structured log line.
 *
 * Usage:
 *
 *   export default withHandler({
 *     methods: ['GET', 'POST'],
 *     auth: 'required',
 *     handler: async ({ req, res, body, session }) => {
 *       const role = await db.users.getRole(session.id);
 *       res.json(200, { ... });
 *     }
 *   });
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { auth as authRepo } from './index.js';
import { AppError, badRequest, isAppError, methodNotAllowed, unauthorized } from './errors.js';
import { createLogger } from './logger.js';
import type { SessionUser } from './repositories/auth.js';

const log = createLogger('dal.handler');

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
  body?: unknown;
}

export interface VercelLikeResponse extends ServerResponse {
  json?: (status: number, payload: unknown) => void;
}

/** Augmented response object passed to handlers — always has `.json()`. */
export interface ResponseHelpers {
  json(status: number, payload: unknown): void;
  redirect(status: 301 | 302, location: string): void;
  text(status: number, payload: string): void;
}

export interface HandlerContext<B, A extends 'required' | 'optional' | 'none'> {
  readonly req: VercelLikeRequest;
  readonly res: VercelLikeResponse;
  readonly send: ResponseHelpers;
  readonly body: B;
  /**
   * - `'required'` → `session` is non-null.
   * - `'optional'` → `session` is `SessionUser | null`.
   * - `'none'`     → `session` is `null`.
   */
  readonly session: A extends 'required' ? SessionUser : SessionUser | null;
}

export interface HandlerOptions<B, A extends 'required' | 'optional' | 'none'> {
  readonly methods: readonly HttpMethod[];
  readonly auth: A;
  /** Maximum JSON body size in bytes. Default 256 KiB. */
  readonly maxBodyBytes?: number;
  readonly handler: (ctx: HandlerContext<B, A>) => Promise<void>;
}

export function withHandler<B = unknown, A extends 'required' | 'optional' | 'none' = 'none'>(
  options: HandlerOptions<B, A>
): (req: VercelLikeRequest, res: VercelLikeResponse) => Promise<void> {
  const allowed = new Set(options.methods);
  const allowHeader = options.methods.join(', ');
  const maxBytes = options.maxBodyBytes ?? 256 * 1024;

  return async function handler(req, res) {
    const send = makeResponseHelpers(res);
    const t0 = Date.now();
    try {
      if (!allowed.has(req.method as HttpMethod)) {
        res.setHeader('Allow', allowHeader);
        throw methodNotAllowed(allowHeader);
      }
      const session = await resolveSession(req, options.auth);
      const body = await readJsonBody(req, maxBytes);
      await options.handler({
        req, res, send,
        body: body as B,
        session: session as never
      });
      log.debug('handler.complete', {
        method: req.method, url: req.url, status: res.statusCode, elapsed: Date.now() - t0
      });
    } catch (err) {
      handleError(err, res, send, { method: req.method, url: req.url });
    }
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function makeResponseHelpers(res: VercelLikeResponse): ResponseHelpers {
  return {
    json(status, payload) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    },
    redirect(status, location) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Location', location);
      res.end();
    },
    text(status, payload) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(payload);
    }
  };
}

async function resolveSession(
  req: VercelLikeRequest,
  mode: 'required' | 'optional' | 'none'
): Promise<SessionUser | null> {
  if (mode === 'none') return null;
  const token = bearerToken(req);
  if (!token) {
    if (mode === 'required') throw unauthorized();
    return null;
  }
  return await authRepo.resolveSession(token);
}

function bearerToken(req: VercelLikeRequest): string {
  const header = req.headers?.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function readJsonBody(req: VercelLikeRequest, maxBytes: number): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) return {};
  // Vercel may have parsed the body already.
  if (req.body !== undefined && req.body !== null) return req.body;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      // Drain to satisfy keep-alive, then fail.
      throw badRequest('Body too large.', 'invalid_input', { maxBytes });
    }
    chunks.push(chunk);
  }
  if (!total) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('JSON invalide.', 'invalid_json');
  }
}

function handleError(
  err: unknown,
  res: VercelLikeResponse,
  send: ResponseHelpers,
  context: { method?: string; url?: string }
): void {
  if (isAppError(err)) {
    const e = err as AppError;
    if (e.status >= 500) {
      log.error('handler.error', { ...context, status: e.status, code: e.code, message: e.message, cause: e.cause });
    } else {
      log.info('handler.client_error', { ...context, status: e.status, code: e.code });
    }
    if (e.code === 'method_not_allowed' && e.context && typeof e.context.allow === 'string') {
      res.setHeader('Allow', e.context.allow);
    }
    send.json(e.status, e.toJson());
    return;
  }
  log.error('handler.unhandled', { ...context, error: err });
  send.json(500, { error: 'Erreur serveur cloud.', code: 'internal_error' });
}
