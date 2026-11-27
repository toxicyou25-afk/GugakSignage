/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCacheReadiness, restoreHostManagedMode } from '../public/player/player-runtime.js';
import * as playerRuntime from '../public/player/player-runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('cached Host identity restores managed mode when local config is unavailable', () => {
  const cached = { manifest: { device: { id: 'device-123' } } };
  assert.equal(restoreHostManagedMode({ token: null, deviceId: 'device-123', hostManaged: false }, cached), true);
});

test('a cached manifest for another device does not restore Host-managed mode', () => {
  const cached = { manifest: { device: { id: 'device-123' } } };
  assert.equal(restoreHostManagedMode({ token: null, deviceId: 'different-device', hostManaged: false }, cached), false);
});

test('failed asset preparation keeps the active and persisted manifests unchanged', async () => {
  assert.equal(typeof playerRuntime.promotePreparedManifest, 'function');
  const previousManifest = { version: 1 };
  const nextManifest = { version: 2 };
  const state = { active: previousManifest, persisted: previousManifest };
  const events = [];

  const promoted = await playerRuntime.promotePreparedManifest({
    isCurrent: () => true,
    prepareAssets: async () => false,
    persistManifest: () => {
      events.push('persist');
      state.persisted = nextManifest;
      return true;
    },
    activateManifest: () => {
      events.push('activate');
      state.active = nextManifest;
    },
  });

  assert.equal(promoted, false);
  assert.strictEqual(state.active, previousManifest);
  assert.strictEqual(state.persisted, previousManifest);
  assert.deepEqual(events, []);
});

test('manifest persistence failure leaves the candidate inactive', async () => {
  const events = [];
  const promoted = await playerRuntime.promotePreparedManifest({
    isCurrent: () => true,
    prepareAssets: async () => { events.push('prepare'); return true; },
    persistManifest: () => { events.push('persist'); return false; },
    activateManifest: () => events.push('activate'),
  });

  assert.equal(promoted, false);
  assert.deepEqual(events, ['prepare', 'persist']);
});

test('a superseded manifest is not persisted or activated after asset preparation', async () => {
  const events = [];
  let current = true;
  const promoted = await playerRuntime.promotePreparedManifest({
    isCurrent: () => current,
    prepareAssets: async () => { events.push('prepare'); current = false; return true; },
    persistManifest: () => { events.push('persist'); return true; },
    activateManifest: () => events.push('activate'),
  });

  assert.equal(promoted, false);
  assert.deepEqual(events, ['prepare']);
});

test('a complete cache is persisted before the candidate becomes active', async () => {
  const events = [];
  const promoted = await playerRuntime.promotePreparedManifest({
    isCurrent: () => true,
    prepareAssets: async () => { events.push('prepare'); return true; },
    persistManifest: () => { events.push('persist'); return true; },
    activateManifest: () => events.push('activate'),
  });

  assert.equal(promoted, true);
  assert.deepEqual(events, ['prepare', 'persist', 'activate']);
});

test('a partial asset download leaves the active media intact and discards staged assets', async () => {
  assert.equal(typeof playerRuntime.prepareAssetBatch, 'function');
  const activeMedia = new Map([['previous-content', new Blob(['previous'])]]);
  const stagedMedia = new Map();
  let promotionCount = 0;

  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'new-content-1' },
    { id: 'new-content-2' },
  ], {
    isCurrent: () => true,
    hasCachedContent: (id) => activeMedia.has(id),
    fetchAsset: async (content) => content.id === 'new-content-1' ? new Blob(['complete']) : null,
    stageAsset: async (content, blob) => {
      const stageId = `stage:${content.id}`;
      stagedMedia.set(stageId, blob);
      return { contentId: content.id, stageId };
    },
    promoteStagedAssets: async (items) => {
      promotionCount += 1;
      for (const item of items) {
        activeMedia.set(item.contentId, stagedMedia.get(item.stageId));
        stagedMedia.delete(item.stageId);
      }
    },
    discardStagedAssets: async (items) => {
      for (const item of items) stagedMedia.delete(item.stageId);
    },
  });

  assert.equal(prepared, false);
  assert.deepEqual([...activeMedia.keys()], ['previous-content']);
  assert.equal(stagedMedia.size, 0);
  assert.equal(promotionCount, 0);
});


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
  const oldResult = cache.prepare(oldToken, async (isCurrent) => {
    await gate.promise;
    return isCurrent();
  });
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
  const oldResult = cache.prepare(oldToken, async (isCurrent) => {
    await gate.promise;
    return isCurrent();
  });
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
