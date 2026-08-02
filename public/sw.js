'use strict';

const STATIC_CACHE = 'vidzy-static-v4';
const IMAGE_CACHE = 'vidzy-images-v1';
const SHELL = ['/', '/offline.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  const allowed = new Set([STATIC_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !allowed.has(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map(key => cache.delete(key)));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || /vidzy\.org|hesgoaler\.com/.test(url.hostname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
        .then(response => response || caches.match('/offline.html'))
    );
    return;
  }

  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request).then(response => {
          if (response.ok) {
            cache.put(request, response.clone());
            trimCache(IMAGE_CACHE, 80);
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
