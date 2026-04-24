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
  const rows = await supabaseFetch('/rest/v1/app_state?id=eq.' + encodeURIComponent(ROOT_ID) + '&select=data', {
    method: 'GET',
    service: true
  });
  if (rows && rows[0] && rows[0].data) return rows[0].data;
  const initial = defaultRootState();
  await saveRootState(initial);
  return initial;
}

async function saveRootState(root) {
  await supabaseFetch('/rest/v1/app_state?on_conflict=id', {
    method: 'POST',
    service: true,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ id: ROOT_ID, data: root || defaultRootState() })
  });
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
  validateProvider
};
