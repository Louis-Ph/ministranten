// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workerSource = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CURRENT_CACHE = 'minis-wettstetten-v3';
const LEGACY_CACHE = 'minis-wettstetten-v2';
const DEFAULT_SCOPE = 'https://minis.example/';

function createWorker(scope = DEFAULT_SCOPE) {
  const listeners = new Map();
  const stores = new Map();
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const cacheStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn(async (request, response) => cacheStore(CURRENT_CACHE).set(key(request), response)),
    match: vi.fn(async (request) => cacheStore(CURRENT_CACHE).get(key(request))?.clone())
  };
  const caches = {
    open: vi.fn(async (name) => {
      if (name !== CURRENT_CACHE) throw new Error('Unexpected cache: ' + name);
      cacheStore(name);
      return cache;
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name) => stores.delete(name))
  };
  const fetch = vi.fn().mockResolvedValue(new Response('online'));
  const self = {
    location: new URL('sw.js', scope),
    registration: { scope },
    addEventListener: (name, listener) => listeners.set(name, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn().mockResolvedValue(undefined) }
  };
  vm.runInNewContext(workerSource, { self, caches, fetch, URL, Response });
  return {
    cache, caches, fetch, self, stores,
    seed(path, body, name = CURRENT_CACHE) {
      cacheStore(name).set(key(path), new Response(body));
    },
    dispatchFetch(path, { mode, ...options } = {}) {
      const request = new Request(new URL(path, scope), options);
      if (mode) Object.defineProperty(request, 'mode', { value: mode });
      const event = { request, respondWith: vi.fn() };
      listeners.get('fetch')(event);
      return { ...event, response: event.respondWith.mock.calls[0]?.[0] };
    },
    async dispatchLifecycle(name) {
      const event = { waitUntil: vi.fn() };
      listeners.get(name)(event);
      await event.waitUntil.mock.calls[0][0];
    }
  };
}

describe('service worker public resource boundary', () => {
  it.each(['/api', '/api/', '/api/config', '/api/data?table=users', '/api/auth/user', '/api%2fdata'])
  ('leaves %s to the browser even when a legacy response exists', (path) => {
    const worker = createWorker();
    worker.seed(path, 'stale private data', LEGACY_CACHE);
    const event = worker.dispatchFetch(path);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.caches.open).not.toHaveBeenCalled();
  });

  it.each([
    { headers: { Authorization: 'Bearer test-token' } },
    { headers: { Cookie: 'session=test-cookie' } },
    { headers: { Range: 'bytes=0-9' } },
    { method: 'POST' }
  ])('does not intercept authenticated, partial, or non-GET requests: %j', (options) => {
    const worker = createWorker();
    expect(worker.dispatchFetch('/index.html', options).respondWith).not.toHaveBeenCalled();
    expect(worker.caches.open).not.toHaveBeenCalled();
  });

  it.each([
    'https://other.example/icon.svg',
    'https://project.supabase.co/auth/v1/user',
    'https://cdnjs.cloudflare.com/ajax/libs/sql.js/sql-wasm.js',
    'chrome-extension://extension/icon.svg',
    '/private-report.json',
    '/account',
    '/sw.js'
  ])('does not intercept an unlisted or external resource: %s', (path) => {
    const worker = createWorker();
    expect(worker.dispatchFetch(path).respondWith).not.toHaveBeenCalled();
  });

  it('uses the api path segment boundary and supports a nested app scope', async () => {
    const worker = createWorker('https://minis.example/apiary/');
    const event = worker.dispatchFetch('./index.html');
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.response).text()).toBe('online');
    expect(worker.dispatchFetch('./api/config').respondWith).not.toHaveBeenCalled();
  });

  it('caches a successful public resource after fetching the network', async () => {
    const worker = createWorker();
    worker.seed('/icon.svg', 'old icon');
    const event = worker.dispatchFetch('/icon.svg');
    expect(await (await event.response).text()).toBe('online');
    expect(worker.fetch).toHaveBeenCalledWith(event.request);
    expect(worker.cache.put).toHaveBeenCalledOnce();
    expect(await worker.stores.get(CURRENT_CACHE).get(DEFAULT_SCOPE + 'icon.svg').text()).toBe('online');
  });

  it.each([404, 500, 503])('returns HTTP %s without replacing the offline copy', async (status) => {
    const worker = createWorker();
    worker.seed('/index.html', 'healthy shell');
    worker.fetch.mockResolvedValue(new Response('error', { status }));
    const response = await worker.dispatchFetch('/index.html').response;
    expect(response.status).toBe(status);
    expect(worker.cache.put).not.toHaveBeenCalled();
    expect(await worker.stores.get(CURRENT_CACHE).get(DEFAULT_SCOPE + 'index.html').text()).toBe('healthy shell');
  });

  it.each([
    { 'Cache-Control': 'private, max-age=60' },
    { 'Cache-Control': 'public, no-store' },
    { 'Cache-Control': 'no-cache' },
    { Vary: 'Accept-Encoding, Authorization' },
    { Vary: 'Cookie' },
    { Vary: '*' }
  ])('respects response headers that prevent public offline reuse: %j', async (headers) => {
    const worker = createWorker();
    worker.fetch.mockResolvedValue(new Response('private', { headers }));
    expect(await (await worker.dispatchFetch('/index.html').response).text()).toBe('private');
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('does not cache a redirected resource', async () => {
    const worker = createWorker();
    const response = new Response('login page');
    Object.defineProperty(response, 'redirected', { value: true });
    worker.fetch.mockResolvedValue(response);
    expect(await worker.dispatchFetch('/index.html').response).toBe(response);
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('does not store callback query parameters in cache keys', async () => {
    const worker = createWorker();
    await worker.dispatchFetch('/?code=one-time-code').response;
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it('returns the online response when cache storage is unavailable', async () => {
    const worker = createWorker();
    worker.cache.put.mockRejectedValue(new Error('Storage quota exceeded'));
    expect(await (await worker.dispatchFetch('/icon.svg').response).text()).toBe('online');
  });
});

describe('service worker offline shell and cache migration', () => {
  it('preserves offline navigation with the precached app shell', async () => {
    const worker = createWorker();
    worker.seed('./', 'offline shell');
    worker.fetch.mockRejectedValue(new TypeError('Network unavailable'));
    const event = worker.dispatchFetch('/index?screen=dienstplan', { mode: 'navigate' });
    expect(await (await event.response).text()).toBe('offline shell');
  });

  it('serves a cached public icon while offline', async () => {
    const worker = createWorker();
    worker.seed('/icon.svg', 'offline icon');
    worker.fetch.mockRejectedValue(new TypeError('Network unavailable'));
    expect(await (await worker.dispatchFetch('/icon.svg').response).text()).toBe('offline icon');
  });

  it('does not read stale responses from legacy cache namespaces', async () => {
    const worker = createWorker();
    worker.seed('/icon.svg', 'legacy response', LEGACY_CACHE);
    worker.fetch.mockRejectedValue(new TypeError('Network unavailable'));
    const response = await worker.dispatchFetch('/icon.svg').response;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Offline');
  });

  it('installs the public shell and icons for offline use', async () => {
    const worker = createWorker();
    await worker.dispatchLifecycle('install');
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.cache.addAll).toHaveBeenCalledWith(expect.arrayContaining([
      './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'
    ]));
  });

  it('activation purges legacy API responses and keeps unrelated caches', async () => {
    const worker = createWorker();
    worker.seed('/api/data', 'private legacy data', LEGACY_CACHE);
    worker.seed('/index.html', 'old shell', 'minis-wettstetten-v1');
    worker.seed('/index.html', 'current shell');
    worker.seed('/other', 'another app', 'another-app-v1');
    await worker.dispatchLifecycle('activate');
    expect([...worker.stores.keys()]).toEqual([CURRENT_CACHE, 'another-app-v1']);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });
});

describe('service worker registration', () => {
  it('uses the dedicated worker and handles registration failure without an unsafe Blob fallback', async () => {
    const registrationSource = indexHtml.match(/  function registerServiceWorker\(\) \{[\s\S]*?\n  \}/)?.[0];
    expect(registrationSource).toBeTruthy();
    const register = vi.fn().mockRejectedValue(new Error('Worker unavailable'));
    const warn = vi.fn();
    vm.runInNewContext(registrationSource + '\nregisterServiceWorker();', {
      ACTIVE_BACKEND: 'cloud', BACKENDS: { MOCK: 'mock' }, urlParams: new URLSearchParams(),
      navigator: { serviceWorker: { register } }, console: { warn }
    });
    await Promise.resolve();
    expect(register).toHaveBeenCalledExactlyOnceWith('./sw.js', { scope: './' });
    expect(warn).toHaveBeenCalledOnce();
    expect(indexHtml).not.toContain('const swCode =');
  });
});
