'use strict';

const ROLE_ORDER = Object.freeze({ user: 1, admin: 2, dev: 3 });
const VALID_PROVIDERS = new Set(['google', 'github', 'azure', 'apple']);
const FREE_DEFAULT_PROVIDERS = Object.freeze(['google', 'github', 'azure']);
const ROOT_ID = 'main';
const DEFAULT_ROOT_STATE = Object.freeze({
  users: {},
  publicProfiles: {},
  services: {},
  stats: {},
  chat: {}
});
const REST_TABLES = Object.freeze({
  ROLES: 'app_roles',
  USERS: 'app_users',
  SERVICES: 'service_events',
  ATTENDEES: 'service_attendees',
  STATS: 'user_stats',
  CHAT: 'chat_messages'
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'http_error';
  }
}

function readEnv(name, aliases) {
  const keys = [name].concat(aliases || []);
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return '';
}

function config() {
  return {
    supabaseUrl: readEnv('SUPABASE_URL'),
    publishableKey: readEnv('SUPABASE_PUBLISHABLE_KEY', ['SUPABASE_ANON_KEY']),
    serviceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
    appBaseUrl: readEnv('APP_BASE_URL', ['VERCEL_PROJECT_PRODUCTION_URL']),
    allowedEmailDomains: readEnv('APP_ALLOWED_EMAIL_DOMAINS')
  };
}

function missingConfigKeys() {
  const cfg = config();
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.publishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (!cfg.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

function configurationStatus() {
  const cfg = config();
  const missing = missingConfigKeys();
  return {
    configured: missing.length === 0,
    missing,
    auth: {
      providers: configuredOAuthProviders(),
      allowedEmailDomains: cfg.allowedEmailDomains || ''
    }
  };
}

function configuredOAuthProviders() {
  const raw = readEnv('APP_OAUTH_PROVIDERS');
  const requested = raw ? raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : FREE_DEFAULT_PROVIDERS;
  const seen = new Set();
  return requested.filter(provider => {
    if (!VALID_PROVIDERS.has(provider) || seen.has(provider)) return false;
    seen.add(provider);
    return true;
  });
}

function isConfigured() {
  return missingConfigKeys().length === 0;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  sendJson(res, status, {
    error: status >= 500 ? 'Erreur serveur cloud.' : err.message,
    code: err && err.code ? err.code : 'server_error'
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new HttpError(400, 'JSON invalide.', 'invalid_json')); }
    });
    req.on('error', reject);
  });
}

function normalizePath(path) {
  const raw = String(path || '/').trim();
  return '/' + raw.replace(/^\/+|\/+$/g, '');
}

function parts(path) {
  return normalizePath(path).split('/').filter(Boolean);
}

function pathGet(root, path) {
  const chain = parts(path);
  if (!chain.length) return root;
  return chain.reduce((node, key) => (node == null ? null : node[key]), root);
}

function pathSet(root, path, value) {
  const chain = parts(path);
  if (!chain.length) return value || {};
  const copy = clone(root || {});
  let node = copy;
  for (let i = 0; i < chain.length - 1; i += 1) {
    const key = chain[i];
    if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) node[key] = {};
    node = node[key];
  }
  const leaf = chain[chain.length - 1];
  if (value === null) delete node[leaf];
  else node[leaf] = value;
  return copy;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergePlain(base, patch) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return Object.assign({}, patch || {});
  return Object.assign({}, base, patch || {});
}

function limitObjectTail(value, limit) {
  if (!limit || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - Number(limit))));
}

async function supabaseFetch(path, options) {
  const cfg = config();
  if (!isConfigured()) throw new HttpError(503, 'Cloud non configure.', 'cloud_not_configured');
  const service = options && options.service;
  const key = service ? cfg.serviceRoleKey : cfg.publishableKey;
  const headers = Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key
  }, options && options.headers ? options.headers : {});
  const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + path, Object.assign({}, options, { headers }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch (_) { data = text ? { message: text } : null; }
  if (!res.ok) {
    if (data && data.code === 'PGRST205') {
      throw new HttpError(
        503,
        'Schema Supabase manquant. Execute supabase/schema.sql une fois dans le SQL Editor.',
        'schema_not_installed'
      );
    }
    if (data && data.code === '42501') {
      throw new HttpError(
        503,
        'Permissions Supabase insuffisantes pour service_role. Reexecute supabase/schema.sql afin d appliquer les GRANT serveur.',
        'db_permission_denied'
      );
    }
    const message = data && data.message ? data.message : 'Supabase request failed.';
    throw new HttpError(res.status, message, data && data.code ? data.code : 'supabase_error');
  }
  return data;
}

function defaultRootState() {
  return clone(DEFAULT_ROOT_STATE);
}

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function msToIso(value, fallback) {
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  return new Date(fallback == null ? Date.now() : fallback).toISOString();
}

function isoToMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function restPath(table, query) {
  return '/rest/v1/' + table + (query ? '?' + query : '');
}

function eq(column, value) {
  return encodeURIComponent(column) + '=eq.' + encodeURIComponent(String(value));
}

async function selectRows(table, query) {
  return await supabaseFetch(restPath(table, query || 'select=*'), {
    method: 'GET',
    service: true
  });
}

async function upsertRows(table, rows, conflict) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (!payload.length) return;
  await supabaseFetch(restPath(table, conflict ? 'on_conflict=' + encodeURIComponent(conflict) : ''), {
    method: 'POST',
    service: true,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(payload)
  });
}

async function patchRows(table, filter, patch) {
  if (!patch || !Object.keys(patch).length) return;
  await supabaseFetch(restPath(table, filter), {
    method: 'PATCH',
    service: true,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
}

async function deleteRows(table, filter) {
  await supabaseFetch(restPath(table, filter), {
    method: 'DELETE',
    service: true,
    headers: { Prefer: 'return=minimal' }
  });
}

function userRowToPrivateProfile(row) {
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name || row.username,
    role: row.role_id || 'user',
    mustChangePassword: !!row.must_change_password,
    createdAt: isoToMs(row.created_at)
  };
}

function publicProfileFromUser(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName || profile.username
  };
}

function userRow(uid, profile) {
  const username = String(profile && profile.username || '').trim().toLowerCase();
  return {
    user_id: uid,
    username,
    email: String(profile && profile.email || (username ? username + '@minis-wettstetten.de' : '')).toLowerCase(),
    display_name: String(profile && profile.displayName || username || uid).slice(0, 60),
    role_id: ['user', 'admin', 'dev'].includes(profile && profile.role) ? profile.role : 'user',
    must_change_password: profile && profile.mustChangePassword === false ? false : true,
    created_at: msToIso(profile && profile.createdAt)
  };
}

function serviceRow(serviceId, service) {
  return {
    service_id: serviceId,
    title: String(service && service.title || '').slice(0, 120),
    description: String(service && service.description || '').slice(0, 1200),
    start_at: msToIso(service && service.startMs),
    deadline_days: Math.max(0, Math.min(30, Number(service && service.deadlineDays) || 0)),
    min_slots: Math.max(1, Math.min(50, Number(service && service.minSlots) || 1)),
    color: /^#[0-9a-fA-F]{6}$/.test(service && service.color) ? service.color : '#0066cc',
    replacement_needed: !!(service && service.replacement),
    stats_applied: !!(service && service.statsApplied),
    created_by: isUuid(service && service.createdBy) ? service.createdBy : null,
    created_at: msToIso(service && service.createdAt)
  };
}

function serviceRowToModel(row) {
  return {
    title: row.title,
    description: row.description || '',
    startMs: isoToMs(row.start_at),
    deadlineDays: row.deadline_days || 0,
    minSlots: row.min_slots || 1,
    color: row.color || '#0066cc',
    replacement: !!row.replacement_needed,
    statsApplied: !!row.stats_applied,
    createdBy: row.created_by || null,
    createdAt: isoToMs(row.created_at),
    attendees: {}
  };
}

function attendeeRow(serviceId, attendee) {
  return {
    service_id: serviceId,
    user_id: attendee && attendee.uid,
    signed_up_at: msToIso(attendee && attendee.ts)
  };
}

function statsRow(uid, stats) {
  return {
    user_id: uid,
    attended: Math.max(0, Number(stats && stats.attended) || 0),
    cancelled: Math.max(0, Number(stats && stats.cancelled) || 0),
    late_cancelled: Math.max(0, Number(stats && stats.lateCancelled) || 0)
  };
}

function chatRow(messageId, message) {
  const isSystem = !!(message && message.system);
  return {
    message_id: messageId,
    author_user_id: !isSystem && isUuid(message && message.uid) ? message.uid : null,
    body: String(message && message.text || '').slice(0, 2000),
    system: isSystem,
    triggered_by: isUuid(message && message.triggeredBy) ? message.triggeredBy : null,
    created_at: msToIso(message && message.ts)
  };
}

function chatRowToModel(row, users) {
  const profile = row.author_user_id ? users[row.author_user_id] : null;
  const triggeredBy = row.triggered_by || null;
  if (row.system) {
    return {
      uid: '__system__',
      username: 'SYSTEM',
      displayName: 'SYSTEM',
      text: row.body,
      ts: isoToMs(row.created_at),
      system: true,
      triggeredBy
    };
  }
  return {
    uid: row.author_user_id,
    username: profile ? profile.username : '',
    displayName: profile ? profile.displayName : '',
    text: row.body,
    ts: isoToMs(row.created_at),
    system: false
  };
}

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function requireUser(req) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Authentification requise.', 'unauthorized');
  const cfg = config();
  const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + token }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.id) throw new HttpError(401, 'Session invalide.', 'invalid_session');
  enforceEmailDomain(data.email);
  return data;
}

function enforceEmailDomain(email) {
  const configured = config().allowedEmailDomains;
  if (!configured) return;
  const domains = configured.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!domains.length) return;
  const domain = String(email || '').split('@')[1] || '';
  if (!domains.includes(domain.toLowerCase())) {
    throw new HttpError(403, 'Domaine e-mail non autorise.', 'email_domain_denied');
  }
}

async function getRootState() {
  const [userRows, serviceRows, attendeeRows, statsRows, chatRows] = await Promise.all([
    selectRows(REST_TABLES.USERS, 'select=user_id,username,email,display_name,role_id,must_change_password,created_at&order=username.asc'),
    selectRows(REST_TABLES.SERVICES, 'select=service_id,title,description,start_at,deadline_days,min_slots,color,replacement_needed,stats_applied,created_by,created_at&order=start_at.asc'),
    selectRows(REST_TABLES.ATTENDEES, 'select=service_id,user_id,signed_up_at&order=signed_up_at.asc'),
    selectRows(REST_TABLES.STATS, 'select=user_id,attended,cancelled,late_cancelled'),
    selectRows(REST_TABLES.CHAT, 'select=message_id,author_user_id,body,system,triggered_by,created_at&order=created_at.asc')
  ]);
  const root = defaultRootState();
  for (const row of userRows || []) {
    const profile = userRowToPrivateProfile(row);
    root.users[row.user_id] = profile;
    root.publicProfiles[row.user_id] = publicProfileFromUser(profile);
  }
  for (const row of serviceRows || []) {
    root.services[row.service_id] = serviceRowToModel(row);
  }
  for (const row of attendeeRows || []) {
    const service = root.services[row.service_id];
    const profile = root.users[row.user_id];
    if (!service || !profile) continue;
    service.attendees[row.user_id] = {
      uid: row.user_id,
      username: profile.username,
      displayName: profile.displayName || profile.username,
      ts: isoToMs(row.signed_up_at)
    };
  }
  for (const row of statsRows || []) {
    root.stats[row.user_id] = {
      attended: row.attended || 0,
      cancelled: row.cancelled || 0,
      lateCancelled: row.late_cancelled || 0
    };
  }
  for (const row of chatRows || []) {
    root.chat[row.message_id] = chatRowToModel(row, root.users);
  }
  return root;
}

async function replaceServices(services) {
  await deleteRows(REST_TABLES.ATTENDEES, 'service_id=not.is.null');
  await deleteRows(REST_TABLES.SERVICES, 'service_id=not.is.null');
  const serviceRows = [];
  const attendeeRows = [];
  for (const [serviceId, service] of Object.entries(services || {})) {
    serviceRows.push(serviceRow(serviceId, service));
    for (const attendee of Object.values(service.attendees || {})) {
      if (isUuid(attendee && attendee.uid)) attendeeRows.push(attendeeRow(serviceId, attendee));
    }
  }
  if (serviceRows.length) await upsertRows(REST_TABLES.SERVICES, serviceRows, 'service_id');
  if (attendeeRows.length) await upsertRows(REST_TABLES.ATTENDEES, attendeeRows, 'service_id,user_id');
}

async function replaceStats(stats) {
  await deleteRows(REST_TABLES.STATS, 'user_id=not.is.null');
  const rows = Object.entries(stats || {})
    .filter(([uid]) => isUuid(uid))
    .map(([uid, value]) => statsRow(uid, value));
  if (rows.length) await upsertRows(REST_TABLES.STATS, rows, 'user_id');
}

async function replaceChat(chat) {
  await deleteRows(REST_TABLES.CHAT, 'message_id=not.is.null');
  const rows = Object.entries(chat || {}).map(([messageId, message]) => chatRow(messageId, message));
  if (rows.length) await upsertRows(REST_TABLES.CHAT, rows, 'message_id');
}

async function saveRootState(root) {
  const state = root || defaultRootState();
  const users = Object.entries(state.users || {})
    .filter(([uid]) => isUuid(uid))
    .map(([uid, profile]) => userRow(uid, profile));
  if (users.length) await upsertRows(REST_TABLES.USERS, users, 'user_id');
  await replaceStats(state.stats || {});
  await replaceServices(state.services || {});
  await replaceChat(state.chat || {});
}

async function upsertService(serviceId, service, replaceAttendees) {
  await upsertRows(REST_TABLES.SERVICES, serviceRow(serviceId, service), 'service_id');
  if (!replaceAttendees) return;
  await deleteRows(REST_TABLES.ATTENDEES, eq('service_id', serviceId));
  const rows = Object.values(service.attendees || {})
    .filter(attendee => isUuid(attendee && attendee.uid))
    .map(attendee => attendeeRow(serviceId, attendee));
  if (rows.length) await upsertRows(REST_TABLES.ATTENDEES, rows, 'service_id,user_id');
}

async function updateServiceField(serviceId, field, value) {
  const map = {
    title: 'title',
    description: 'description',
    startMs: 'start_at',
    deadlineDays: 'deadline_days',
    minSlots: 'min_slots',
    color: 'color',
    replacement: 'replacement_needed',
    statsApplied: 'stats_applied',
    createdBy: 'created_by',
    createdAt: 'created_at'
  };
  const column = map[field];
  if (!column) return;
  let dbValue = value;
  if (field === 'startMs' || field === 'createdAt') dbValue = msToIso(value);
  if (field === 'replacement' || field === 'statsApplied') dbValue = !!value;
  if (field === 'createdBy') dbValue = isUuid(value) ? value : null;
  await patchRows(REST_TABLES.SERVICES, eq('service_id', serviceId), { [column]: dbValue });
}

async function writeDataPath(path, value) {
  const p = parts(path);
  if (!p.length) return saveRootState(value || defaultRootState());
  const [root, id, field, childId] = p;
  if (root === 'users') {
    if (!id || !isUuid(id)) return;
    if (p.length === 2) {
      if (value === null) return deleteRows(REST_TABLES.USERS, eq('user_id', id));
      return upsertRows(REST_TABLES.USERS, userRow(id, value || {}), 'user_id');
    }
    const map = { username: 'username', email: 'email', displayName: 'display_name', role: 'role_id', mustChangePassword: 'must_change_password', createdAt: 'created_at' };
    const column = map[field];
    if (!column) return;
    const patch = { [column]: field === 'createdAt' ? msToIso(value) : value };
    if (field === 'mustChangePassword') patch[column] = !!value;
    await patchRows(REST_TABLES.USERS, eq('user_id', id), patch);
    return;
  }
  if (root === 'publicProfiles') {
    if (!id || !isUuid(id)) return;
    if (p.length === 2 && value) {
      await patchRows(REST_TABLES.USERS, eq('user_id', id), {
        username: value.username,
        display_name: value.displayName || value.username
      });
    } else if (p.length === 3 && ['username', 'displayName'].includes(field)) {
      await patchRows(REST_TABLES.USERS, eq('user_id', id), {
        [field === 'displayName' ? 'display_name' : 'username']: value
      });
    }
    return;
  }
  if (root === 'services') {
    if (!id) return replaceServices(value || {});
    if (p.length === 2) {
      if (value === null) return deleteRows(REST_TABLES.SERVICES, eq('service_id', id));
      return upsertService(id, value || {}, true);
    }
    if (field === 'attendees') {
      if (!childId) {
        await deleteRows(REST_TABLES.ATTENDEES, eq('service_id', id));
        const rows = Object.values(value || {})
          .filter(attendee => isUuid(attendee && attendee.uid))
          .map(attendee => attendeeRow(id, attendee));
        if (rows.length) await upsertRows(REST_TABLES.ATTENDEES, rows, 'service_id,user_id');
        return;
      }
      if (value === null) return deleteRows(REST_TABLES.ATTENDEES, eq('service_id', id) + '&' + eq('user_id', childId));
      if (isUuid(childId)) return upsertRows(REST_TABLES.ATTENDEES, attendeeRow(id, Object.assign({}, value, { uid: childId })), 'service_id,user_id');
      return;
    }
    return updateServiceField(id, field, value);
  }
  if (root === 'stats') {
    if (!id || !isUuid(id)) return replaceStats(value || {});
    if (p.length === 2) return upsertRows(REST_TABLES.STATS, statsRow(id, value || {}), 'user_id');
    const map = { attended: 'attended', cancelled: 'cancelled', lateCancelled: 'late_cancelled' };
    if (!map[field]) return;
    const state = await getRootState();
    const current = Object.assign({ attended: 0, cancelled: 0, lateCancelled: 0 }, state.stats[id] || {});
    current[field] = Math.max(0, Number(value) || 0);
    await upsertRows(REST_TABLES.STATS, statsRow(id, current), 'user_id');
    return;
  }
  if (root === 'chat') {
    if (!id) return replaceChat(value || {});
    if (value === null) return deleteRows(REST_TABLES.CHAT, eq('message_id', id));
    return upsertRows(REST_TABLES.CHAT, chatRow(id, value || {}), 'message_id');
  }
}

function roleFor(root, uid) {
  const profile = root && root.users && root.users[uid];
  return profile && profile.role ? profile.role : 'user';
}

function roleAtLeast(role, minRole) {
  return (ROLE_ORDER[role] || 0) >= (ROLE_ORDER[minRole] || 0);
}

function assertReadAllowed(path, uid, role) {
  const p = parts(path);
  const root = p[0] || '';
  if (!root) {
    if (!roleAtLeast(role, 'dev')) throw new HttpError(403, 'Lecture root reservee au role dev.', 'forbidden');
    return;
  }
  if (root === 'publicProfiles' || root === 'services' || root === 'chat') return;
  if (root === 'users') {
    if (p.length >= 2 && p[1] === uid) return;
    if (roleAtLeast(role, 'admin')) return;
  }
  if (root === 'stats') {
    if (p.length >= 2 && p[1] === uid) return;
    if (roleAtLeast(role, 'admin')) return;
  }
  throw new HttpError(403, 'Lecture refusee.', 'forbidden');
}

function assertWriteAllowed(path, uid, role, value) {
  const p = parts(path);
  const root = p[0] || '';
  if (!root) {
    if (!roleAtLeast(role, 'dev')) throw new HttpError(403, 'Import root reserve au role dev.', 'forbidden');
    return;
  }
  if (root === 'users') {
    if (p[1] === uid && ['displayName', 'mustChangePassword'].includes(p[2])) return;
    if (roleAtLeast(role, 'dev')) return;
  }
  if (root === 'publicProfiles') {
    if (p[1] === uid && ['displayName', 'username'].includes(p[2])) return;
    if (roleAtLeast(role, 'dev')) return;
  }
  if (root === 'services') {
    if (roleAtLeast(role, 'admin')) return;
    if (p[2] === 'attendees' && p[3] === uid) return;
    if (p[2] === 'replacement') return;
  }
  if (root === 'chat') {
    if (value && value.uid === uid) return;
    if (value && value.uid === '__system__' && value.triggeredBy === uid) return;
  }
  if (root === 'stats') {
    if (p[1] === uid && ['attended', 'cancelled', 'lateCancelled'].includes(p[2])) return;
    if (roleAtLeast(role, 'admin')) return;
  }
  throw new HttpError(403, 'Ecriture refusee.', 'forbidden');
}

function validateProvider(provider) {
  if (!VALID_PROVIDERS.has(provider)) throw new HttpError(400, 'Provider OAuth non supporte.', 'invalid_provider');
}

module.exports = {
  HttpError,
  assertReadAllowed,
  assertWriteAllowed,
  clone,
  config,
  configurationStatus,
  configuredOAuthProviders,
  defaultRootState,
  enforceEmailDomain,
  getRootState,
  isConfigured,
  limitObjectTail,
  mergePlain,
  normalizePath,
  pathGet,
  pathSet,
  readBody,
  requireUser,
  roleAtLeast,
  roleFor,
  saveRootState,
  sendError,
  sendJson,
  supabaseFetch,
  validateProvider,
  writeDataPath
};
