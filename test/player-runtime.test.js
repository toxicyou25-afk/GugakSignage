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

test('a repeated poll for the same manifest does not cancel an in-flight asset preparation', async () => {
  const cache = createCacheReadiness();
  const firstToken = cache.begin('device-1:manifest-4');
  const gate = deferred();
  let calls = 0;
  const first = cache.prepare(firstToken, async (isCurrent) => {
    calls += 1;
    await gate.promise;
    return isCurrent();
  });

  const repeatedToken = cache.begin('device-1:manifest-4');
  const repeated = cache.prepare(repeatedToken, async () => { calls += 1; return true; });
  gate.resolve();

  assert.equal(repeatedToken, firstToken);
  assert.deepEqual(await Promise.all([first, repeated]), [true, true]);
  assert.equal(calls, 1);
});

test('manifest offset stays anchored to response receipt through a delayed asset preparation', () => {
  assert.equal(typeof playerRuntime.calculateServerOffsetMs, 'function');
  const serverTime = '2026-11-28T00:00:00.000Z';
  const serverMs = Date.parse(serverTime);
  const receivedAt = serverMs + 1_500;
  const measuredOffset = playerRuntime.calculateServerOffsetMs(serverTime, receivedAt, 0);

  assert.equal(measuredOffset, -1_500);
  assert.equal(measuredOffset, playerRuntime.calculateServerOffsetMs(serverTime, receivedAt, 0));
  assert.notEqual(measuredOffset, playerRuntime.calculateServerOffsetMs(serverTime, receivedAt + 5_000, 0));
  assert.equal(playerRuntime.calculateServerOffsetMs('invalid server time', receivedAt, -250), -250);
});

test('browser-managed LAN media requests carry the Player token while Player Host requests do not', () => {
  assert.equal(typeof playerRuntime.playerMediaHeaders, 'function');
  assert.deepEqual(playerRuntime.playerMediaHeaders(false, 'player-token'), { Authorization: 'Bearer player-token' });
  assert.deepEqual(playerRuntime.playerMediaHeaders(true, null), {});
});

test('same-device Player windows serialize registration and reuse the shared pending token', async () => {
  assert.equal(typeof playerRuntime.withPlayerRegistrationLock, 'function');
  assert.equal(typeof playerRuntime.selectRegistrationToken, 'function');
  let tail = Promise.resolve();
  const locks = {
    request: async (_name, _options, operation) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try { return await operation(); } finally { release(); }
    },
  };
  const storage = { lastCode: '', activeToken: null, pendingCode: '', pendingToken: null };
  let tokenCreates = 0;
  const registerWindow = () => playerRuntime.withPlayerRegistrationLock(locks, async () => {
    const selected = playerRuntime.selectRegistrationToken(storage, 'GUGAK1', () => {
      tokenCreates += 1;
      return 'a'.repeat(64);
    });
    if (selected.pending) {
      storage.pendingCode = 'GUGAK1';
      storage.pendingToken = selected.token;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    storage.activeToken = selected.token;
    storage.lastCode = 'GUGAK1';
    storage.pendingCode = '';
    storage.pendingToken = null;
    return selected.token;
  });

  const [first, second] = await Promise.all([registerWindow(), registerWindow()]);
  assert.equal(first, second);
  assert.equal(tokenCreates, 1);
  assert.equal(storage.activeToken, first);
  const otherDevice = playerRuntime.selectRegistrationToken(storage, 'GUGAK2', () => {
    tokenCreates += 1;
    return 'b'.repeat(64);
  });
  assert.equal(otherDevice.token, 'b'.repeat(64));
  assert.equal(otherDevice.pending, true);
  assert.equal(tokenCreates, 2);
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
