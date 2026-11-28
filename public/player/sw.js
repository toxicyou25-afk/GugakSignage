/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const CACHE = 'gugak-signage-shell-v7';
const SHELL = [
  './', './index.html', './styles.css', './player.js', './player-runtime.js',
  '/engine/index.js',
  '/engine/types.js',
  '/engine/src/validation.js',
  '/engine/src/layout.js',
  '/engine/src/timeline.js',
  '/engine/src/image.js',
  '/engine/src/render-plan.js',
  '/engine/src/patterns.js',
  '/engine/src/snapshot.js',
  '/engine/src/wall-input.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const hadPreviousShell = keys.some((key) => key.startsWith('gugak-signage-shell-') && key !== CACHE);
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!hadPreviousShell) return;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Do not wait for navigation inside the activate event: the navigation
      // cannot complete while the activating worker is still awaiting this task.
      windows.forEach((client) => client.navigate(client.url).catch(() => null));
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ?? (await caches.match('./index.html'));
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || (!url.pathname.startsWith('/player/') && !url.pathname.startsWith('/engine/'))) return;
  if (event.request.method !== 'GET') return;
  if (
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    event.request.destination === 'script' ||
    event.request.destination === 'style'
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }
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
