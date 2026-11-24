// SPDX-License-Identifier: Apache-2.0
const CACHE_VERSION = 'gugak-player-v3';
const CORE = [
  '/player/',
  '/player/player.js',
  '/player/styles.css',
  '/shared/render.js',
  '/engine/index.js',
  '/engine/types.js',
  '/engine/src/validation.js',
  '/engine/src/layout.js',
  '/engine/src/timeline.js',
  '/engine/src/image.js',
  '/engine/src/render-plan.js',
  '/engine/src/patterns.js',
  '/engine/src/snapshot.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (
    url.pathname.startsWith('/player/') ||
    url.pathname.startsWith('/engine/') ||
    url.pathname.startsWith('/shared/')
  ) {
    event.respondWith(networkFirst(event.request));
  }
});
