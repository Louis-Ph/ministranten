import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import healthHandler from '../../api/health.ts';
import { configureDal, restoreDal, healthyFetch, jsonResponse, invokeHandler, RPC_NAMES } from './dal-health-fixtures.js';

beforeEach(configureDal);
afterEach(restoreDal);

describe('cloud readiness', () => {
  it('checks every table, RPC availability and Auth without executing writes or exposing rows', async () => {
    const fetch = vi.fn(healthyFetch);
    vi.stubGlobal('fetch', fetch);
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, configured: true, schema: 'ready', root: 'ready', rootKeys: ['chat', 'publicProfiles', 'services', 'stats', 'users'] });
    expect(fetch).toHaveBeenCalledTimes(8);
    for (const [url, options] of fetch.mock.calls) {
      expect(options.method).toBe('GET');
      expect(new URL(url).pathname).not.toContain('/rpc/');
      if (new URL(url).pathname.startsWith('/rest/v1/') && new URL(url).pathname !== '/rest/v1/') {
        expect(Number(new URL(url).searchParams.get('limit'))).toBeLessThanOrEqual(3);
        expect(new URL(url).searchParams.get('select')).not.toBe('*');
      }
    }
    const users = fetch.mock.calls.find(([url]) => new URL(url).pathname === '/rest/v1/app_users');
    expect(new URL(users[0]).searchParams.get('select')).toContain('must_change_password');
    expect(JSON.stringify(res.body)).not.toContain('service-test-secret');
  });

  it.each(['app_roles', 'app_users', 'service_events', 'service_attendees', 'user_stats', 'chat_messages'])('reports 503 when %s is absent even if app_roles otherwise works', async table => {
    vi.stubGlobal('fetch', vi.fn(url => new URL(url).pathname === '/rest/v1/' + table
      ? jsonResponse({ code: 'PGRST205', message: 'private upstream diagnostic' }, 404)
      : healthyFetch(url)));
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, configured: true, schema: 'not_ready', code: 'schema_not_installed' });
    expect(JSON.stringify(res.body)).not.toContain('private upstream diagnostic');
  });

  it('detects missing columns in an otherwise installed table', async () => {
    vi.stubGlobal('fetch', vi.fn(url => new URL(url).pathname === '/rest/v1/service_events'
      ? jsonResponse({ code: '42703', message: 'column stats_applied does not exist' }, 400)
      : healthyFetch(url)));
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('schema_not_installed');
  });

  it('rejects an empty role catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(url => new URL(url).pathname === '/rest/v1/app_roles' ? jsonResponse([]) : healthyFetch(url)));
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('schema_not_installed');
  });

  it.each(RPC_NAMES)('detects an unavailable %s RPC using only the catalog', async missingRpc => {
    vi.stubGlobal('fetch', vi.fn(url => new URL(url).pathname === '/rest/v1/'
      ? jsonResponse({ paths: Object.fromEntries(RPC_NAMES.filter(name => name !== missingRpc).map(name => ['/rpc/' + name, { post: {} }])) })
      : healthyFetch(url)));
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('schema_not_installed');
  });

  it('reports Auth failure as unavailable even when all database checks pass', async () => {
    vi.stubGlobal('fetch', vi.fn(url => new URL(url).pathname === '/auth/v1/settings'
      ? jsonResponse({ message: 'invalid public-test-key' }, 401)
      : healthyFetch(url)));
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, configured: true });
    expect(JSON.stringify(res.body)).not.toContain('public-test-key');
  });

  it('reports only missing variable names and makes no requests when unconfigured', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = await invokeHandler(healthHandler);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, configured: false, missing: ['SUPABASE_SERVICE_ROLE_KEY'], schema: 'not_checked', code: 'cloud_not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
