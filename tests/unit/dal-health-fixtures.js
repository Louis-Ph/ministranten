import { vi } from 'vitest';
import { resetConfigForTests } from '../../api/_lib/dal/config.ts';

export const RPC_NAMES = [
  'increment_user_stat', 'set_user_stat', 'replace_stats', 'replace_attendees_of',
  'upsert_service_with_attendees', 'replace_services', 'replace_chat', 'replace_root_state'
];

export function configureDal() {
  vi.stubEnv('SUPABASE_URL', 'https://readiness.invalid');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-secret');
  vi.stubEnv('APP_OAUTH_PROVIDERS', 'google,github,azure');
  vi.stubEnv('DAL_HTTP_MAX_RETRIES', '0');
  vi.stubEnv('DAL_LOG_LEVEL', 'error');
  resetConfigForTests();
}

export function restoreDal() {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetConfigForTests();
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function healthyFetch(url) {
  const path = new URL(url).pathname;
  if (path === '/rest/v1/') {
    return jsonResponse({ paths: Object.fromEntries(RPC_NAMES.map(name => ['/rpc/' + name, { post: {} }])) });
  }
  if (path === '/rest/v1/app_roles') return jsonResponse(['user', 'admin', 'dev'].map(role_id => ({ role_id })));
  if (path === '/auth/v1/settings') return jsonResponse({ external: { google: true, github: true, azure: false } });
  return jsonResponse([]);
}

export async function invokeHandler(handler, req = {}) {
  const response = {
    headersSent: false,
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); }
  };
  await handler({ method: 'GET', headers: {}, ...req }, response);
  return response;
}
