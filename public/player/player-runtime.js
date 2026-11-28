/* SPDX-License-Identifier: Apache-2.0 */
/**
 * A single-flight, generation-aware cache readiness coordinator. Kept free of
 * DOM and IndexedDB dependencies so request races can be regression-tested.
 */
export function restoreHostManagedMode(runtime, cached) {
  return runtime.hostManaged || (
    !runtime.token
    && Boolean(runtime.deviceId && cached?.manifest?.device?.id === runtime.deviceId)
  );
}

export function calculateServerOffsetMs(serverTime, receivedAt, fallback) {
  const serverMs = Date.parse(serverTime);
  return Number.isFinite(serverMs) ? serverMs - receivedAt : fallback;
}

export function selectRegistrationToken(storage, code, createToken) {
  if (storage.lastCode === code && storage.activeToken) {
    return { token: storage.activeToken, pending: false };
  }
  if (storage.pendingCode === code && storage.pendingToken) {
    return { token: storage.pendingToken, pending: true };
  }
  return { token: createToken(), pending: true };
}

export async function withPlayerRegistrationLock(lockManager, operation) {
  if (!lockManager || typeof lockManager.request !== 'function') return operation();
  return lockManager.request('gugak-signage-player-registration', { mode: 'exclusive' }, operation);
}

export async function promotePreparedManifest({ isCurrent, prepareAssets, persistManifest, activateManifest }) {
  if (!isCurrent()) return false;
  const prepared = await prepareAssets();
  if (!prepared || !isCurrent()) return false;
  if (!persistManifest()) return false;
  activateManifest();
  return true;
}

export async function prepareAssetBatch(contents, {
  isCurrent,
  hasCachedContent,
  fetchAsset,
  stageAsset,
  promoteStagedAssets,
  discardStagedAssets,
}) {
  const stagedItems = [];
  try {
    for (const content of contents) {
      if (!isCurrent()) return false;
      if (await hasCachedContent(content.id)) continue;
      const blob = await fetchAsset(content);
      if (!blob || blob.size <= 0 || !isCurrent()) return false;
      stagedItems.push(await stageAsset(content, blob));
    }
    if (!isCurrent()) return false;
    await promoteStagedAssets(stagedItems);
    stagedItems.length = 0;
    return true;
  } finally {
    if (stagedItems.length) await discardStagedAssets(stagedItems);
  }
}

export function createCacheReadiness() {
  let generation = 0;
  let currentKey = null;
  const flights = new Map();
  let ready = false;

  return {
    get ready() { return ready; },
    begin(key) {
      if (key !== undefined && key !== null && key === currentKey) return generation;
      generation += 1;
      currentKey = key ?? null;
      ready = false;
      for (const [token, operation] of flights) {
        if (token < generation) flights.delete(token);
        void operation.catch(() => {});
      }
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    async prepare(token, prepareAssets) {
      if (token !== generation) return false;
      if (flights.has(token)) return flights.get(token);
      const operation = Promise.resolve()
        .then(() => prepareAssets(() => token === generation))
        .then(Boolean, () => false);
      flights.set(token, operation);
      const result = await operation;
      if (flights.get(token) === operation) flights.delete(token);
      if (token !== generation) return false;
      ready = result;
      return ready;
    },
    invalidate() {
      generation += 1;
      currentKey = null;
      ready = false;
      for (const [token, operation] of flights) {
        if (token < generation) flights.delete(token);
        void operation.catch(() => {});
      }
    },
  };
}
