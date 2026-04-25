/**
 * /api/data — Generic path-based data access endpoint.
 *
 * Authentication required. Authorization is enforced per-path against the
 * caller's role.
 *
 * Path surface:
 *   /                                 (dev only — full root state)
 *   /users/:uid[/<field>]
 *   /publicProfiles/:uid[/<field>]
 *   /services[/:id[/<field>[/:childId]]]
 *   /stats[/:uid[/<field>]]
 *   /chat[/:messageId]
 *
 * Implementation notes:
 *   - Reads are targeted: a `GET /api/data?path=/services/abc` hits a
 *     single Postgres SELECT via `db.services.getById(...)`, never the
 *     full root state.
 *   - Multi-row replacements are routed through atomic RPC functions
 *     (see supabase/migrations/0002_dal_atomic_rpc.sql) so failures
 *     never leave the database half-written.
 *   - Stats writes use `db.stats.setField` (RPC) which is race-free
 *     under concurrent updates.
 */

import {
  authz, db, errors, types, requireRole, loadRootState
} from './_lib/dal/index.js';
import { getSupabase } from './_lib/dal/supabase.js';
import { withHandler } from './_lib/dal/handler.js';

type Path = readonly string[];

// ---------------------------------------------------------------------------
// Targeted reads.
// ---------------------------------------------------------------------------

async function readPath(path: Path, limit?: number): Promise<unknown> {
  if (!path.length) return await loadRootState();

  const [root, id, field, childId] = path;
  switch (root) {
    case 'users': {
      if (!id) {
        const all = await db.users.listAll();
        const out: Record<string, types.PrivateUserProfile> = {};
        for (const { uid, profile } of all) out[uid] = profile;
        return out;
      }
      const profile = await db.users.getById(id);
      if (path.length === 2) return profile;
      if (!profile) return null;
      return (profile as unknown as Record<string, unknown>)[field];
    }
    case 'publicProfiles': {
      const map = await db.users.listPublicProfiles();
      if (!id) return map;
      const entry = map[id];
      if (path.length === 2) return entry || null;
      if (!entry) return null;
      return (entry as unknown as Record<string, unknown>)[field];
    }
    case 'services': {
      // Authors are needed only to render attendee names.
      const authors = await db.users.listPublicProfiles();
      if (!id) return await db.services.listAll(authors);
      const service = await db.services.getById(id, authors);
      if (path.length === 2) return service;
      if (!service) return null;
      if (field === 'attendees') {
        if (!childId) return service.attendees;
        return service.attendees[childId] || null;
      }
      return (service as unknown as Record<string, unknown>)[field];
    }
    case 'stats': {
      if (!id) return await db.stats.listAll();
      const stats = await db.stats.getByUser(id);
      if (path.length === 2) return stats;
      return (stats as unknown as Record<string, unknown>)[field];
    }
    case 'chat': {
      const authors = await db.users.listPublicProfiles();
      if (!id) return await db.chat.listLatest(limit, authors);
      return await db.chat.getById(id, authors);
    }
    default:
      throw errors.badRequest('Unknown root: ' + root);
  }
}

// ---------------------------------------------------------------------------
// Targeted writes.
// ---------------------------------------------------------------------------

async function writePath(path: Path, value: unknown): Promise<void> {
  if (!path.length) {
    // Dev-only full import — single atomic RPC. We don't expose
    // `replace_root_state` on a repository because no domain concept owns
    // the entire "root" — it's deliberately a backend-admin operation.
    await getSupabase().rpc.call('replace_root_state', {
      p_root: value || types.emptyRootState()
    });
    return;
  }

  const [root, id, field, childId] = path;
  switch (root) {
    case 'users': {
      if (!id || !types.isUuid(id)) throw errors.badRequest('Invalid user id');
      if (path.length === 2) {
        if (value === null) return await db.users.remove(id);
        return await db.users.insert(id, value as types.PrivateUserProfile);
      }
      const patch: Parameters<typeof db.users.patch>[1] = {};
      if (field === 'username' && typeof value === 'string') patch.username = value;
      else if (field === 'email' && typeof value === 'string') patch.email = value;
      else if (field === 'displayName' && typeof value === 'string') patch.displayName = value;
      else if (field === 'role' && types.isValidRole(value)) patch.role = value;
      else if (field === 'mustChangePassword') patch.mustChangePassword = !!value;
      else throw errors.badRequest('Unknown user field: ' + field);
      return await db.users.patch(id, patch);
    }
    case 'publicProfiles': {
      if (!id || !types.isUuid(id)) throw errors.badRequest('Invalid user id');
      if (path.length === 2 && value && typeof value === 'object') {
        const v = value as { username?: string; displayName?: string };
        return await db.users.patch(id, {
          username: v.username,
          displayName: v.displayName || v.username
        });
      }
      if (path.length === 3 && (field === 'username' || field === 'displayName')) {
        return await db.users.patch(id, { [field]: String(value || '') });
      }
      return;
    }
    case 'services': {
      if (!id) {
        return await db.services.replaceAll((value as Record<string, types.Service>) || {});
      }
      if (path.length === 2) {
        if (value === null) return await db.services.remove(id);
        return await db.services.upsert(id, (value as types.Service) || {}, { replaceAttendees: true });
      }
      if (field === 'attendees') {
        if (!childId) {
          const list = Object.values((value || {}) as Record<string, types.Attendee>)
            .filter((a): a is types.Attendee => !!a && types.isUuid(a.uid));
          return await db.services.replaceAttendeesOf(id, list);
        }
        if (value === null) return await db.services.removeAttendee(id, childId);
        if (types.isUuid(childId)) {
          return await db.services.upsertAttendee(id, {
            uid: childId,
            ts: Number((value as { ts?: number })?.ts) || Date.now(),
            username: '',
            displayName: ''
          });
        }
        return;
      }
      return await db.services.patchField(id, field as never, value);
    }
    case 'stats': {
      if (!id) return await db.stats.replaceAll((value as Record<string, types.UserStats>) || {});
      if (!types.isUuid(id)) throw errors.badRequest('Invalid user id');
      if (path.length === 2) {
        return await db.stats.upsert(id, (value as types.UserStats) || { attended: 0, cancelled: 0, lateCancelled: 0 });
      }
      if (!types.isValidStatField(field)) throw errors.badRequest('Unknown stat field: ' + field);
      // Atomic absolute-set via RPC. Frontend that wants increment can call
      // a future POST /api/stats/:uid/:field/increment endpoint instead.
      await db.stats.setField(id, field, Number(value) || 0);
      return;
    }
    case 'chat': {
      if (!id) return await db.chat.replaceAll((value as Record<string, types.ChatMessage>) || {});
      if (value === null) return await db.chat.remove(id);
      return await db.chat.upsert(id, (value || {}) as types.ChatMessage);
    }
    default:
      throw errors.badRequest('Unknown root: ' + root);
  }
}

// ---------------------------------------------------------------------------
// Path utilities.
// ---------------------------------------------------------------------------

const parsePath = authz.parsePath;

function getQueryString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

// ---------------------------------------------------------------------------
// Handler.
// ---------------------------------------------------------------------------

export default withHandler<{ path?: string; value?: unknown }, 'required'>({
  methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
  auth: 'required',
  async handler({ req, body, session, send }) {
    const role = await requireRole(db.users, session.id);

    if (req.method === 'GET') {
      const path = parsePath(getQueryString(req.query?.path));
      authz.assertReadAllowed(path, session.id, role);
      const limit = Number(getQueryString(req.query?.limit)) || undefined;
      const value = await readPath(path, limit);
      send.json(200, { value: value == null ? null : value });
      return;
    }

    const path = parsePath(body.path ?? getQueryString(req.query?.path));
    let value: unknown;
    if (req.method === 'DELETE') {
      value = null;
    } else if (req.method === 'PATCH') {
      // PATCH = read-merge-write. Targeted read for the merge.
      const current = await readPath(path);
      value = mergePlain(current, body.value);
    } else {
      value = body.value;
    }
    authz.assertWriteAllowed(path, session.id, role, value);
    await writePath(path, value);
    send.json(200, { ok: true });
  }
});

function mergePlain(base: unknown, patch: unknown): unknown {
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return Object.assign({}, patch || {});
  }
  return Object.assign({}, base, patch || {});
}
