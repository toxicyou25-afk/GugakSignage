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

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

test('an asset matching its manifest SHA-256 checksum is promoted', async () => {
  const body = 'trusted-image'.repeat(1024);
  const activeMedia = new Map([['poster-1', new Blob(['previous'])]]);
  let promotionCount = 0;

  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: (await sha256Hex(body)).toUpperCase() },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => false,
    fetchAsset: async () => new Blob([body]),
    stageAsset: async (content, blob) => ({ contentId: content.id, blob }),
    promoteStagedAssets: async (items) => {
      promotionCount += 1;
      for (const item of items) activeMedia.set(item.contentId, item.blob);
    },
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, true);
  assert.equal(promotionCount, 1);
  assert.equal(await activeMedia.get('poster-1').text(), body);
});

test('a malformed manifest checksum is rejected before downloading or staging', async () => {
  let fetchCount = 0;
  let stageCount = 0;
  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: 'g'.repeat(64) },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => false,
    fetchAsset: async () => { fetchCount += 1; return new Blob(['content']); },
    stageAsset: async () => { stageCount += 1; return {}; },
    promoteStagedAssets: async () => {},
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, false);
  assert.equal(fetchCount, 0);
  assert.equal(stageCount, 0);
});

test('a checksum-verified cached blob is reused without a download', async () => {
  const body = 'trusted-image';
  let fetchCount = 0;
  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: await sha256Hex(body) },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => true,
    readCachedAsset: async () => new Blob([body]),
    fetchAsset: async () => { fetchCount += 1; return new Blob([body]); },
    stageAsset: async () => { throw new Error('verified cache must not be staged'); },
    promoteStagedAssets: async () => {},
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, true);
  assert.equal(fetchCount, 0);
});

test('a checksum-mismatched cached blob is not skipped and is replaced only by verified bytes', async () => {
  const expectedBody = 'trusted-image';
  const corruptBody = 'X'.repeat(expectedBody.length);
  const activeMedia = new Map([['poster-1', new Blob([corruptBody])]]);
  let fetchCount = 0;

  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: await sha256Hex(expectedBody) },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => true,
    readCachedAsset: async () => activeMedia.get('poster-1'),
    fetchAsset: async () => {
      fetchCount += 1;
      return new Blob([expectedBody]);
    },
    stageAsset: async (content, blob) => ({ contentId: content.id, blob }),
    promoteStagedAssets: async (items) => {
      for (const item of items) activeMedia.set(item.contentId, item.blob);
    },
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, true);
  assert.equal(fetchCount, 1);
  assert.equal(await activeMedia.get('poster-1').text(), expectedBody);
});

test('a checksum-mismatched cached blob without a verified replacement leaves active media intact', async () => {
  const corrupt = new Blob(['corrupt!']);
  const activeMedia = new Map([['poster-1', corrupt]]);
  let promotionCount = 0;

  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: await sha256Hex('complete') },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => true,
    readCachedAsset: async () => corrupt,
    fetchAsset: async () => new Blob(['same-len']),
    stageAsset: async (content, blob) => ({ contentId: content.id, blob }),
    promoteStagedAssets: async () => { promotionCount += 1; },
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, false);
  assert.equal(promotionCount, 0);
  assert.strictEqual(activeMedia.get('poster-1'), corrupt);
});

test('a checksum-less legacy manifest still reuses its cached asset', async () => {
  let readCount = 0;
  const prepared = await playerRuntime.prepareAssetBatch([{ id: 'legacy-poster' }], {
    isCurrent: () => true,
    hasCachedContent: () => true,
    readCachedAsset: async () => { readCount += 1; return new Blob(['legacy']); },
    fetchAsset: async () => { throw new Error('legacy cache should be reused'); },
    stageAsset: async () => { throw new Error('legacy cache must not be staged'); },
    promoteStagedAssets: async () => {},
    discardStagedAssets: async () => {},
  });

  assert.equal(prepared, true);
  assert.equal(readCount, 0);
});

test('manifest asset integrity fingerprint is order independent and changes with bytes identity', () => {
  assert.equal(typeof playerRuntime.assetIntegrityFingerprint, 'function');
  const checksumA = 'a'.repeat(64);
  const checksumB = 'b'.repeat(64);
  const first = playerRuntime.assetIntegrityFingerprint([
    { id: 'image-b', checksum: checksumB },
    { id: 'image-a', checksum: checksumA },
  ]);
  const reordered = playerRuntime.assetIntegrityFingerprint([
    { id: 'image-a', checksum: checksumA },
    { id: 'image-b', checksum: checksumB },
  ]);
  const changed = playerRuntime.assetIntegrityFingerprint([
    { id: 'image-a', checksum: 'c'.repeat(64) },
    { id: 'image-b', checksum: checksumB },
  ]);

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test('streaming SHA-256 matches known answers at block and padding boundaries', async () => {
  const knownAnswers = new Map([
    [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [1, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'],
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [63, '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    [65, '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'],
  ]);
  for (const [length, expected] of knownAnswers) {
    const bytes = 'a'.repeat(length);
    assert.equal(await sha256Hex(bytes), expected, `length=${length}`);
  }
  const exact = 'chunked hashing crosses 64-byte boundaries without concatenating the input';
  const expected = await sha256Hex(exact);
  const bytes = new TextEncoder().encode(exact);
  for (const chunkSize of [1, 7, 55, 56, 63, 64, 65, 1024]) {
    const blob = {
      stream: () => new ReadableStream({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            controller.enqueue(bytes.slice(offset, offset + chunkSize));
          }
          controller.close();
        },
      }),
    };
    const hashContent = { id: 'chunked', checksum: expected };
    assert.equal(await playerRuntime.verifyAssetBlob(hashContent, blob), true, `chunkSize=${chunkSize}`);
  }
});

test('a same-length corrupt asset fails integrity verification without replacing active media', async () => {
  const expectedChecksum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('trusted-image'));
  const checksumHex = [...new Uint8Array(expectedChecksum)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const activeMedia = new Map([['poster-1', new Blob(['previous-good-image'])]]);
  const stagedMedia = new Map();
  const previousManifest = { version: 1, contentId: 'poster-1' };
  const candidateManifest = { version: 2, contentId: 'poster-1' };
  const state = { activeManifest: previousManifest, persistedManifest: previousManifest };
  let promotionCount = 0;

  const candidateBytes = new Blob(['X'.repeat('trusted-image'.length)]);
  const prepared = await playerRuntime.prepareAssetBatch([
    { id: 'poster-1', checksum: checksumHex },
  ], {
    isCurrent: () => true,
    hasCachedContent: () => false,
    fetchAsset: async () => candidateBytes,
    stageAsset: async (content, blob) => {
      stagedMedia.set(content.id, blob);
      return { contentId: content.id };
    },
    promoteStagedAssets: async (items) => {
      promotionCount += 1;
      for (const item of items) activeMedia.set(item.contentId, stagedMedia.get(item.contentId));
    },
    discardStagedAssets: async (items) => {
      for (const item of items) stagedMedia.delete(item.contentId);
    },
  });
  const promoted = await playerRuntime.promotePreparedManifest({
    isCurrent: () => true,
    prepareAssets: async () => prepared,
    persistManifest: () => { state.persistedManifest = candidateManifest; return true; },
    activateManifest: () => { state.activeManifest = candidateManifest; },
  });

  assert.equal(prepared, false);
  assert.equal(promoted, false);
  assert.equal(promotionCount, 0);
  assert.deepEqual([...activeMedia.keys()], ['poster-1']);
  assert.equal(await activeMedia.get('poster-1').text(), 'previous-good-image');
  assert.equal(stagedMedia.size, 0);
  assert.strictEqual(state.activeManifest, previousManifest);
  assert.strictEqual(state.persistedManifest, previousManifest);
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

test('removing corrupt playback media invalidates readiness so the same manifest can refill it', async () => {
  const cache = createCacheReadiness();
  const playerState = { cacheReady: false };
  const manifestKey = 'device-1:manifest-4:sha256';
  const persistentMedia = new Map([['poster-1', 'verified-bytes']]);
  const firstToken = cache.begin(manifestKey);
  playerState.cacheReady = await cache.prepare(firstToken, async () => persistentMedia.has('poster-1'));
  assert.equal(cache.ready, true);
  assert.equal(playerState.cacheReady, true);

  persistentMedia.delete('poster-1');
  assert.equal(typeof playerRuntime.invalidateCacheReadinessAfterAssetRemoval, 'function');
  playerRuntime.invalidateCacheReadinessAfterAssetRemoval(cache, playerState);

  assert.equal(cache.ready, false);
  assert.equal(playerState.cacheReady, false);
  const retryToken = cache.begin(manifestKey);
  assert.notEqual(retryToken, firstToken);
  let downloadCount = 0;
  playerState.cacheReady = await cache.prepare(retryToken, async () => {
    if (!persistentMedia.has('poster-1')) {
      downloadCount += 1;
      persistentMedia.set('poster-1', 'verified-replacement');
    }
    return persistentMedia.has('poster-1');
  });

  assert.equal(downloadCount, 1);
  assert.equal(persistentMedia.get('poster-1'), 'verified-replacement');
  assert.equal(cache.ready, true);
  assert.equal(playerState.cacheReady, true);
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
