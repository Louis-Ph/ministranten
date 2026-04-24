/**
 * Minis Wettstetten — Service Worker
 *
 * Bewusst als eigenständige Datei ausgelagert (statt Blob-Registrierung), damit
 * der Scope auf `./` zeigt und Browser die PWA als installierbar erkennen.
 * Strategie: Network-first mit Cache-Fallback. Firebase-Realtime-Traffic wird
 * nicht abgefangen, damit Live-Updates nicht durch veraltete Caches blockiert
 * werden.
 */

'use strict';

const CACHE = 'minis-wettstetten-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Firebase & sql.js CDN werden nicht gecached, um Live-Daten nicht zu blockieren.
  if (/firebaseio|firebasedatabase|googleapis|gstatic|cdnjs\.cloudflare\.com/.test(req.url)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      try {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      } catch (_) { /* ignore */ }
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

/** Push-Benachrichtigungen (FCM liefert den Payload als JSON). */
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
