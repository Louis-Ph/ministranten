/**
 * DAL — Minimal structured logger.
 *
 * Why not pino/winston? Cold-start cost matters on Vercel, and a serverless
 * function only needs JSON-on-stdout. This logger is ~30 lines and does the
 * one thing that matters: emit structured records that show up in Vercel's
 * log stream as searchable JSON.
 *
 * Usage:
 *   const log = createLogger('repo.services');
 *   log.info('upsert.start', { serviceId });
 *   log.warn('upsert.retry', { attempt, error });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  readonly module: string;
  child(extra: Record<string, unknown>): Logger;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.DAL_LOG_LEVEL as LogLevel) || 'info';
const MIN_LEVEL_NUM = LEVELS[MIN_LEVEL] ?? LEVELS.info;

export function createLogger(module: string, base: Record<string, unknown> = {}): Logger {
  const ctx = Object.freeze({ ...base });
  return {
    module,
    child(extra) {
      return createLogger(module, { ...ctx, ...extra });
    },
    debug(event, fields) { emit('debug', module, ctx, event, fields); },
    info(event, fields) { emit('info', module, ctx, event, fields); },
    warn(event, fields) { emit('warn', module, ctx, event, fields); },
    error(event, fields) { emit('error', module, ctx, event, fields); }
  };
}

function emit(
  level: LogLevel,
  module: string,
  base: Record<string, unknown>,
  event: string,
  fields?: Record<string, unknown>
): void {
  if (LEVELS[level] < MIN_LEVEL_NUM) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    module,
    event,
    ...base,
    ...(fields || {})
  };
  // Errors carry stacks — preserve them.
  const out = JSON.stringify(record, replacer);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
