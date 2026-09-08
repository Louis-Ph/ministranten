import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpRequest } from '../../api/_lib/dal/http.ts';
import { configureDal, restoreDal, jsonResponse } from './dal-health-fixtures.js';

beforeEach(configureDal);
afterEach(restoreDal);

describe('read-only automatic retries', () => {
  it('recovers a read after a transient server failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}, 503)).mockResolvedValueOnce(jsonResponse([{ role_id: 'dev' }]));
    vi.stubGlobal('fetch', fetch);
    const result = await httpRequest({ method: 'GET', url: 'https://readiness.invalid/rest/v1/app_roles', maxRetries: 1 });
    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recovers a read after a lost connection', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetch);
    await expect(httpRequest({ method: 'GET', url: 'https://readiness.invalid/rest/v1/app_users', maxRetries: 1 })).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry an invalid read', async () => {
    const fetch = vi.fn(() => jsonResponse({}, 401));
    vi.stubGlobal('fetch', fetch);
    await expect(httpRequest({ method: 'GET', url: 'https://readiness.invalid/auth/v1/settings', maxRetries: 1 })).resolves.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never replays %s when its committed response is lost, even with a retry override', async method => {
    let writes = 0;
    const fetch = vi.fn(async () => {
      writes += 1;
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetch);
    await expect(httpRequest({ method, url: 'https://readiness.invalid/rest/v1/rpc/increment_user_stat', maxRetries: 3 })).rejects.toMatchObject({ code: 'upstream_unavailable' });
    expect(writes).toBe(1);
  });

  it('does not retry a POST after an upstream server error', async () => {
    const fetch = vi.fn(() => jsonResponse({}, 500));
    vi.stubGlobal('fetch', fetch);
    await expect(httpRequest({ method: 'POST', url: 'https://readiness.invalid/auth/v1/admin/users', maxRetries: 1 })).resolves.toMatchObject({ status: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
