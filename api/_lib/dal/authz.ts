/**
 * DAL — Authorization rules for path-based data access.
 *
 * Mirrors the rules that used to live inline in api/data.ts (and before
 * that, in api/_lib/cloud.ts). Extracted here so the rules can be unit-
 * tested in isolation, and so any future endpoint that exposes the same
 * path surface reuses the exact same checks.
 *
 * Path conventions: a path is a `readonly string[]` whose first segment
 * names the aggregate root (`users`, `services`, `stats`, `chat`,
 * `publicProfiles`). Use `parsePath('/services/abc/attendees/uid')` to
 * convert a URL-style string into the canonical form.
 */

import { forbidden } from './errors.js';
import { type RoleId, roleAtLeast } from './types.js';

export type PathParts = readonly string[];

/** Convert a URL-style path string into the canonical `readonly string[]`. */
export function parsePath(raw: unknown): string[] {
  const s = '/' + String(raw || '/').trim().replace(/^\/+|\/+$/g, '');
  return s.split('/').filter(Boolean);
}

/**
 * Throws `forbidden` if the caller cannot read at this path. Read rules:
 *
 *   /                     dev only
 *   /publicProfiles*      everyone
 *   /services*            everyone
 *   /chat*                everyone
 *   /users/<uid>          self always; admin+ for any uid
 *   /stats/<uid>          self always; admin+ for any uid
 */
export function assertReadAllowed(path: PathParts, uid: string, role: RoleId): void {
  const root = path[0] || '';
  if (!root) {
    if (!roleAtLeast(role, 'dev')) throw forbidden('Lecture root reservee au role dev.');
    return;
  }
  if (root === 'publicProfiles' || root === 'services' || root === 'chat') return;
  if (root === 'users' || root === 'stats') {
    if (path.length >= 2 && path[1] === uid) return;
    if (roleAtLeast(role, 'admin')) return;
  }
  throw forbidden('Lecture refusee.');
}

/**
 * Throws `forbidden` if the caller cannot write at this path. Write rules:
 *
 *   /                                     dev only (root import)
 *   /users/<uid>/displayName              self
 *   /users/<uid>/mustChangePassword       self
 *   /users/*                              dev+
 *   /publicProfiles/<uid>/{username,displayName}  self
 *   /publicProfiles/*                     dev+
 *   /services/<id>/replacement            everyone (volunteer flag)
 *   /services/<id>/attendees/<uid>        self
 *   /services/*                           admin+
 *   /chat/<id>                            self (value.uid === caller); or
 *                                         system message triggered by self
 *   /stats/<uid>/<field>                  self for own counters
 *   /stats/*                              admin+
 */
export function assertWriteAllowed(
  path: PathParts,
  uid: string,
  role: RoleId,
  value: unknown
): void {
  const root = path[0] || '';
  if (!root) {
    if (!roleAtLeast(role, 'dev')) throw forbidden('Import root reserve au role dev.');
    return;
  }
  if (root === 'users') {
    if (path[1] === uid && ['displayName', 'mustChangePassword'].includes(path[2])) return;
    if (roleAtLeast(role, 'dev')) return;
  }
  if (root === 'publicProfiles') {
    if (path[1] === uid && ['displayName', 'username'].includes(path[2])) return;
    if (roleAtLeast(role, 'dev')) return;
  }
  if (root === 'services') {
    if (roleAtLeast(role, 'admin')) return;
    if (path[2] === 'attendees' && path[3] === uid) return;
    if (path[2] === 'replacement') return;
  }
  if (root === 'chat' && value && typeof value === 'object') {
    const v = value as { uid?: string; triggeredBy?: string };
    if (v.uid === uid) return;
    if (v.uid === '__system__' && v.triggeredBy === uid) return;
  }
  if (root === 'stats') {
    if (path[1] === uid && ['attended', 'cancelled', 'lateCancelled'].includes(path[2])) return;
    if (roleAtLeast(role, 'admin')) return;
  }
  throw forbidden('Ecriture refusee.');
}
