'use strict';

/* Lilli Sweden — standalone synthetic demonstration.
 *
 * SYNTETISK DEMONSTRATION — inga verkliga patientuppgifter.
 *
 * Cache-first over an ENUMERATED static shell, nothing else. There is no API
 * in this demo, but the rule from the real app still holds: the worker may
 * only ever cache the static demonstration assets listed below. Anything not
 * on the list passes through to the network untouched and uncached.
 */

const CACHE = 'lilli-se-demo-v4';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './i18n.js',
  './app.js',
  './manifest.webmanifest',
  './icons/lilli-192.png',
  './icons/lilli-512.png',
  './icons/apple-touch-icon.png',
  './icons/lilli-avatar.png',
  './icons/vanilli-os-mark.svg',
];

const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // A navigation anywhere inside scope reopens the app shell — this is what
  // makes the installed icon work with no connection at all.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit || fetch(req))
    );
    return;
  }

  if (!SHELL_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // Only a good same-origin response for an enumerated shell file may
      // enter the cache.
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
