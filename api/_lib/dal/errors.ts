/**
 * DAL — Error hierarchy.
 *
 * Two design rules:
 *   1. Every error thrown inside the DAL is an `AppError`. Handlers can rely on
 *      `err.status` and `err.code` without ever seeing a raw fetch / DOMException.
 *   2. Codes are stable (snake_case) and form a small enumeration. Frontend
 *      and tests pattern-match on `code`, never on the message text.
 */

export type ErrorCode =
  // 4xx — client
  | 'invalid_json'
  | 'invalid_input'
  | 'unauthorized'
  | 'invalid_session'
  | 'forbidden'
  | 'email_domain_denied'
  | 'invalid_provider'
  | 'not_found'
  | 'username_taken'
  | 'method_not_allowed'
  // 4xx — auth-domain (preserved from legacy handlers for front-end compat)
  | 'invalid_login'
  | 'refresh_failed'
  | 'pkce_exchange_failed'
  | 'weak_password'
  | 'password_update_failed'
  // 5xx — infra
  | 'cloud_not_configured'
  | 'schema_not_installed'
  | 'db_permission_denied'
  | 'db_constraint_violation'
  | 'db_conflict'
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'supabase_error'
  | 'internal_error';

export interface AppErrorJson {
  readonly error: string;
  readonly code: ErrorCode;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly cause?: unknown;
  /** Optional structured context — attached to logs but never sent to clients. */
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    status: number,
    message: string,
    code: ErrorCode,
    options?: { cause?: unknown; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context ? Object.freeze({ ...options.context }) : undefined;
  }

  /** Sanitized payload for the HTTP response. Never leaks `cause`. */
  toJson(): AppErrorJson {
    return {
      error: this.status >= 500 ? 'Erreur serveur cloud.' : this.message,
      code: this.code
    };
  }
}

/** Thrown when the user's request cannot be parsed or validated. */
export function badRequest(message: string, code: ErrorCode = 'invalid_input', context?: Record<string, unknown>): AppError {
  return new AppError(400, message, code, { context });
}

/** Thrown when authentication is missing or invalid. */
export function unauthorized(message = 'Authentification requise.', code: ErrorCode = 'unauthorized'): AppError {
  return new AppError(401, message, code);
}

/** Thrown when the user is authenticated but not allowed. */
export function forbidden(message = 'Acces refuse.', code: ErrorCode = 'forbidden'): AppError {
  return new AppError(403, message, code);
}

export function notFound(message = 'Ressource introuvable.', code: ErrorCode = 'not_found'): AppError {
  return new AppError(404, message, code);
}

export function conflict(message: string, code: ErrorCode = 'db_conflict'): AppError {
  return new AppError(409, message, code);
}

export function methodNotAllowed(allow: string): AppError {
  const err = new AppError(405, 'Method not allowed.', 'method_not_allowed', { context: { allow } });
  return err;
}

export function upstreamTimeout(detail?: string): AppError {
  return new AppError(504, 'Supabase n a pas repondu a temps.', 'upstream_timeout', {
    context: detail ? { detail } : undefined
  });
}

export function upstreamUnavailable(detail?: string, cause?: unknown): AppError {
  return new AppError(502, 'Supabase indisponible.', 'upstream_unavailable', {
    cause,
    context: detail ? { detail } : undefined
  });
}

export function internalError(message = 'Erreur interne.', cause?: unknown): AppError {
  return new AppError(500, message, 'internal_error', { cause });
}

/** True if the value looks like an `AppError` from this module. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError || (
    typeof value === 'object' && value !== null
      && 'status' in value && typeof (value as { status: unknown }).status === 'number'
      && 'code' in value && typeof (value as { code: unknown }).code === 'string'
  );
}
