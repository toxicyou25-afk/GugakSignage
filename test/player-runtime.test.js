/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCacheReadiness } from '../public/player/player-runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('concurrent prefetch callers share one result instead of replacing cacheReady with undefined', async () => {
  const cache = createCacheReadiness();
  const token = cache.begin();
  const gate = deferred();
  let calls = 0;
  const prepare = () => { calls += 1; return gate.promise; };
  const first = cache.prepare(token, prepare);
  const second = cache.prepare(token, prepare);
  gate.resolve(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls, 1);
  assert.equal(cache.ready, true);
});

test('a previous manifest prefetch cannot overwrite readiness for a newer manifest', async () => {
  const cache = createCacheReadiness();
  const oldToken = cache.begin();
  const gate = deferred();
  const oldResult = cache.prepare(oldToken, () => gate.promise);
  const newToken = cache.begin();
  const newResult = cache.prepare(newToken, async () => false);
  gate.resolve(true);
  assert.equal(await oldResult, false);
  assert.equal(await newResult, false);
  assert.equal(cache.ready, false);
});

test('re-pair invalidation prevents old in-flight cache results from becoming ready', async () => {
  const cache = createCacheReadiness();
  const oldToken = cache.begin();
  const gate = deferred();
  const oldResult = cache.prepare(oldToken, () => gate.promise);
  cache.invalidate();
  gate.resolve(true);
  assert.equal(await oldResult, false);
  assert.equal(cache.ready, false);
});

test('failed cache preparation remains not-ready; a later successful attempt can recover', async () => {
  const cache = createCacheReadiness();
  const first = cache.begin();
  assert.equal(await cache.prepare(first, async () => false), false);
  assert.equal(cache.ready, false);
  const second = cache.begin();
  assert.equal(await cache.prepare(second, async () => true), true);
  assert.equal(cache.ready, true);
});
