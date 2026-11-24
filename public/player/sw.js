/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const CACHE = 'gugak-signage-shell-v2';
const SHELL = [
  './', './index.html', './styles.css', './player.js',
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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || (!url.pathname.startsWith('/player/') && !url.pathname.startsWith('/engine/'))) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      });
    }).catch(() => caches.match('./index.html')),
  );
});
