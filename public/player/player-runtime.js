/* SPDX-License-Identifier: Apache-2.0 */
/**
 * A single-flight, generation-aware cache readiness coordinator. Kept free of
 * DOM and IndexedDB dependencies so request races can be regression-tested.
 */
const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const SHA256_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class StreamingSha256 {
  constructor() {
    this.state = Uint32Array.from([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.totalBytes = 0n;
    this.words = new Uint32Array(64);
    this.finished = false;
  }

  update(chunk) {
    if (this.finished) throw new Error('SHA-256 digest is already finalized');
    this.totalBytes += BigInt(chunk.length);
    let offset = 0;
    if (this.bufferLength) {
      const count = Math.min(64 - this.bufferLength, chunk.length);
      this.buffer.set(chunk.subarray(0, count), this.bufferLength);
      this.bufferLength += count;
      offset += count;
      if (this.bufferLength === 64) {
        this.process(this.buffer);
        this.bufferLength = 0;
      }
    }
    while (offset + 64 <= chunk.length) {
      this.process(chunk.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < chunk.length) {
      this.buffer.set(chunk.subarray(offset), 0);
      this.bufferLength = chunk.length - offset;
    }
  }

  process(block) {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = ((block[offset] << 24) | (block[offset + 1] << 16) |
        (block[offset + 2] << 8) | block[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let a = this.state[0]; let b = this.state[1]; let c = this.state[2]; let d = this.state[3];
    let e = this.state[4]; let f = this.state[5]; let g = this.state[6]; let h = this.state[7];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }

  digest() {
    if (this.finished) throw new Error('SHA-256 digest is already finalized');
    const bitLength = this.totalBytes * 8n;
    this.buffer[this.bufferLength++] = 0x80;
    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength);
      this.process(this.buffer);
      this.bufferLength = 0;
    }
    this.buffer.fill(0, this.bufferLength, 56);
    for (let index = 0; index < 8; index += 1) {
      this.buffer[63 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    }
    this.process(this.buffer);
    this.finished = true;
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }
}

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

export function playerMediaHeaders(hostManaged, token) {
  return !hostManaged && token ? { Authorization: `Bearer ${token}` } : {};
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

export function manifestContentChecksum(content) {
  const checksum = content?.checksum;
  if (checksum === null || checksum === undefined) return null;
  if (typeof checksum !== 'string' || !SHA256_HEX_PATTERN.test(checksum)) {
    throw new Error('manifest content checksum must be a 64-character hexadecimal SHA-256 digest');
  }
  return checksum.toLowerCase();
}

export function assetIntegrityFingerprint(contents) {
  const assets = contents
    .map((content) => [content.id, manifestContentChecksum(content)])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(assets);
}

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

export async function verifyAssetBlob(content, blob) {
  let checksum;
  try {
    checksum = manifestContentChecksum(content);
  } catch {
    return false;
  }
  if (checksum === null) return true;
  if (!blob || typeof blob.stream !== 'function') return false;
  try {
    const hash = new StreamingSha256();
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
      }
    } finally {
      reader.releaseLock();
    }
    return hash.digest() === checksum;
  } catch {
    return false;
  }
}

export async function prepareAssetBatch(contents, {
  isCurrent,
  hasCachedContent,
  verifyCachedContent,
  readCachedAsset,
  fetchAsset,
  stageAsset,
  promoteStagedAssets,
  discardStagedAssets,
}) {
  let expectedChecksums;
  try {
    expectedChecksums = contents.map((content) => manifestContentChecksum(content));
  } catch {
    return false;
  }
  const verifyCached = verifyCachedContent || (
    readCachedAsset
      ? async (content) => {
          const blob = await readCachedAsset(content);
          return Boolean(blob && await verifyAssetBlob(content, blob));
        }
      : null
  );
  const stagedItems = [];
  try {
    for (let index = 0; index < contents.length; index += 1) {
      const content = contents[index];
      const expectedChecksum = expectedChecksums[index];
      if (!isCurrent()) return false;
      if (await hasCachedContent(content.id)) {
        if (expectedChecksum === null) continue;
        if (verifyCached && await verifyCached(content)) continue;
      }
      const blob = await fetchAsset(content);
      if (!blob || blob.size <= 0 || !isCurrent()) return false;
      if (expectedChecksum !== null && (
        !(await verifyAssetBlob(content, blob)) || !isCurrent()
      )) return false;
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

export function invalidateCacheReadinessAfterAssetRemoval(cacheReadiness, playerState) {
  cacheReadiness.invalidate();
  playerState.cacheReady = false;
}
