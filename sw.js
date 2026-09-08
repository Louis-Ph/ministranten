/**
 * Minis Wettstetten — Service Worker
 *
 * Bewusst als eigenständige Datei ausgelagert (statt Blob-Registrierung), damit
 * der Scope auf `./` zeigt und Browser die PWA als installierbar erkennen.
 * Strategie: Network-first mit Cache-Fallback. Cloud-API-Traffic wird nicht
 * abgefangen, damit Live-Updates nicht durch veraltete Caches blockiert werden.
 */

'use strict';

const CACHE_PREFIX = 'minis-wettstetten-';
const CACHE = CACHE_PREFIX + 'v3';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];
const PUBLIC_PATHS = new Set(
  [...PRECACHE, './index'].map((path) => new URL(path, self.registration.scope).pathname)
);
const API_PATH = /(?:^|\/)api(?:\/|$)/;
const PRIVATE_CACHE_CONTROL = /(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/i;
const PRIVATE_VARY = /(?:^|,)\s*(?:authorization|cookie|\*)(?:\s|,|$)/i;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
    ),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // Nur bekannte öffentliche App-Dateien; API- und Auth-Anfragen bleiben live.
  if (url.origin !== self.location.origin || API_PATH.test(url.pathname)) return;
  if (req.headers.has('authorization') || req.headers.has('cookie') || req.headers.has('range')) return;
  if (!PUBLIC_PATHS.has(url.pathname)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok && !fresh.redirected && !url.search &&
          !PRIVATE_CACHE_CONTROL.test(fresh.headers.get('cache-control') || '') &&
          !PRIVATE_VARY.test(fresh.headers.get('vary') || '')) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(req, fresh.clone());
        } catch (_) { /* Speicherfehler dürfen die Online-App nicht blockieren. */ }
      }
      return fresh;
    } catch (_) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

/** Push-Benachrichtigungen liefern den Payload als JSON. */
self.addEventListener('push', (event) => {
  let data = { title: 'Minis Wettstetten', body: 'Neue Nachricht.' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    tag: data.tag || 'minis',
    data: data.data || {}
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});
