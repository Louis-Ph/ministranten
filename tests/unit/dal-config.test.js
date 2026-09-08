import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import configHandler from '../../api/config.ts';
import { configureDal, restoreDal, jsonResponse, invokeHandler } from './dal-health-fixtures.js';

beforeEach(configureDal);
afterEach(restoreDal);

describe('Auth provider diagnosis', () => {
  it.each([201, 401, 403, 500, 503])('does not classify HTTP %s as reachable with disabled providers', async status => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ message: 'private upstream error' }, status)));
    const res = await invokeHandler(configHandler);
    expect(res.statusCode).toBe(200);
    expect(res.body.auth).toMatchObject({ supabaseReachable: false, disabledInSupabase: [] });
    expect(JSON.stringify(res.body)).not.toContain('private upstream error');
  });

  it('distinguishes disabled providers from an unavailable Auth service', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ external: { google: true, github: false, azure: false } })));
    const res = await invokeHandler(configHandler);
    expect(res.body.auth).toMatchObject({ supabaseReachable: true, providers: ['google'], disabledInSupabase: ['github', 'azure'] });
  });

  it('rejects a successful response with no Auth settings', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({})));
    const res = await invokeHandler(configHandler);
    expect(res.body.auth.supabaseReachable).toBe(false);
    expect(res.body.auth.disabledInSupabase).toEqual([]);
  });
});
