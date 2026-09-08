// @vitest-environment node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { checkDeployment, formatReport, loadOperationsConfig } from '../../scripts/ops/check-health.mjs';

const defaults = await loadOperationsConfig();
const health = { ok: true, configured: true, schema: 'ready', root: 'ready' };
const auth = { configured: true, auth: { supabaseReachable: true } };

function configFor(name) {
  const config = structuredClone(defaults);
  config.monitoring.request.attempts = 1;
  config.monitoring.request.retryDelayMs = 0;
  if (name) config.monitoring.checks = { [name]: config.monitoring.checks[name] };
  return config;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function options(fetchImpl) {
  return { env: {}, fetchImpl, sleep: vi.fn().mockResolvedValue() };
}

describe('deployment readiness checks', () => {
  it('checks the website, database and authentication as separate requirements', async () => {
    const fetchImpl = vi.fn(async url => {
      if (url.pathname === '/') return new Response('<title>Minis Wettstetten</title><div id="app"></div>', { headers: { 'content-type': 'text/html' } });
      return json(url.pathname === '/api/health' ? health : auth);
    });
    const report = await checkDeployment(configFor(), options(fetchImpl));
    expect(report.ok).toBe(true);
    expect(report.checks.map(check => check.name)).toEqual(['website', 'database', 'authentication']);
    expect(fetchImpl.mock.calls).toHaveLength(3);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('error');
    }
  });

  it.each([
    ['ok', false], ['configured', false], ['schema', 'not_checked'], ['root', 'missing'], ['ok', 'true']
  ])('rejects HTTP 200 when %s has an incorrect value', async (field, value) => {
    const report = await checkDeployment(configFor('database'), options(async () => json({ ...health, [field]: value })));
    expect(report.ok).toBe(false);
    expect(report.checks[0]).toMatchObject({ code: 'contract', message: `Unexpected value for ${field}.` });
  });

  it('rejects a missing readiness field', async () => {
    const { root: _, ...partial } = health;
    const report = await checkDeployment(configFor('database'), options(async () => json(partial)));
    expect(report.checks[0]).toMatchObject({ ok: false, message: 'Missing field: root.' });
  });

  it.each([null, [], 'healthy'])('rejects non-object JSON readiness responses (%j)', async value => {
    const report = await checkDeployment(configFor('database'), options(async () => json(value)));
    expect(report.ok).toBe(false);
  });

  it('detects unreachable Supabase Auth even if the public config endpoint returns HTTP 200', async () => {
    const report = await checkDeployment(configFor('authentication'), options(async () => json({ ...auth, auth: { supabaseReachable: false } })));
    expect(report.checks[0]).toMatchObject({ ok: false, message: 'Unexpected value for auth.supabaseReachable.' });
  });

  it('rejects an HTML login/error page masquerading as HTTP 200 API success', async () => {
    const report = await checkDeployment(configFor('database'), options(async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })));
    expect(report.checks[0]).toMatchObject({ ok: false, code: 'content_type' });
  });

  it('rejects an unrelated HTML page at the website URL', async () => {
    const report = await checkDeployment(configFor('website'), options(async () => new Response('<html>Deployment unavailable</html>', { headers: { 'content-type': 'text/html' } })));
    expect(report.checks[0]).toMatchObject({ ok: false, code: 'contract' });
  });

  it('rejects malformed JSON without printing the response', async () => {
    const report = await checkDeployment(configFor('database'), options(async () => new Response('private diagnostic data', { headers: { 'content-type': 'application/json' } })));
    expect(report.checks[0]).toMatchObject({ ok: false, code: 'json' });
    expect(formatReport(report)).not.toContain('private diagnostic data');
  });

  it('rejects non-200 status even when the JSON says ready', async () => {
    const report = await checkDeployment(configFor('database'), options(async () => json(health, 503)));
    expect(report.checks[0]).toMatchObject({ ok: false, code: 'http', message: 'HTTP 503.' });
  });

  it('retries a transient failure and reports recovery', async () => {
    const config = configFor('database');
    config.monitoring.request.attempts = 3;
    config.monitoring.request.retryDelayMs = 25;
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json(health));
    const opts = options(fetchImpl);
    const report = await checkDeployment(config, opts);
    expect(report.checks[0]).toMatchObject({ ok: true, attempts: 2 });
    expect(opts.sleep).toHaveBeenCalledExactlyOnceWith(25);
  });

  it('caps retries and does not expose network error details', async () => {
    const config = configFor('database');
    config.monitoring.request.attempts = 2;
    const fetchImpl = vi.fn().mockRejectedValue(new Error('https://private:secret@internal.invalid/private'));
    const opts = options(fetchImpl);
    const report = await checkDeployment(config, opts);
    expect(report.checks[0]).toMatchObject({ ok: false, attempts: 2, code: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
    expect(formatReport(report)).not.toMatch(/secret|internal|private/);
  });

  it('limits response size', async () => {
    const config = configFor('database');
    config.monitoring.request.maxResponseBytes = 5;
    const report = await checkDeployment(config, options(async () => json(health)));
    expect(report.checks[0]).toMatchObject({ ok: false, code: 'body_size' });
  });

  it.each(['headers', 'body'])('times out when the server stalls before completing %s', async stage => {
    const server = createServer((_req, response) => {
      if (stage === 'body') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"ok":');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const config = configFor('database');
      config.monitoring.request.timeoutMs = 100;
      const report = await checkDeployment(config, { env: { APP_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
      expect(report.checks[0]).toMatchObject({ ok: false, code: 'timeout', attempts: 1 });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('supports the existing HEALTH_URL override and derives the remaining service origin', async () => {
    const fetchImpl = vi.fn(async url => url.pathname === '/custom-health' ? json(health) : json(auth));
    const config = configFor();
    delete config.monitoring.checks.website;
    const report = await checkDeployment(config, { ...options(fetchImpl), env: { HEALTH_URL: 'https://preview.example/custom-health' } });
    expect(report.ok).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => url.href)).toEqual(['https://preview.example/custom-health', 'https://preview.example/api/config']);
  });

  it('supports APP_BASE_URL without requiring any credentials', async () => {
    const fetchImpl = vi.fn(async () => json(health));
    await checkDeployment(configFor('database'), { ...options(fetchImpl), env: { APP_BASE_URL: 'https://preview.example' } });
    expect(fetchImpl.mock.calls[0][0].href).toBe('https://preview.example/api/health');
  });

  it.each(['https://user:secret@example.com', 'https://example.com?secret=key', 'file:///etc/passwd'])('rejects credential-bearing or unsupported URLs', async url => {
    const fetchImpl = vi.fn();
    await expect(checkDeployment(configFor('database'), { ...options(fetchImpl), env: { APP_BASE_URL: url } })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails before making requests when the attempt budget is invalid', async () => {
    const config = configFor('database');
    config.monitoring.request.attempts = 0;
    const fetchImpl = vi.fn();
    await expect(checkDeployment(config, options(fetchImpl))).rejects.toThrow('attempts');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
