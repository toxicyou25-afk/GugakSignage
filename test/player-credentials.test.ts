import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlayerCredentialStore, createPlayerIdentityStore } from '../src/player-credentials.js';

test('stores player tokens encrypted at rest and reads them across store instances', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-'));
  const filePath = path.join(directory, 'player-token');
  const token = '0123456789abcdef'.repeat(4);
  try {
    const firstStore = createPlayerCredentialStore({ filePath });
    assert.equal(await firstStore.readToken(), null);
    await firstStore.writeToken(token);

    const ciphertext = await readFile(filePath, 'utf8');
    assert.ok(ciphertext.length > 0);
    assert.notEqual(ciphertext, token);
    assert.equal(ciphertext.includes(token), false);
    assert.equal(await createPlayerCredentialStore({ filePath }).readToken(), token);

    await firstStore.clear();
    await assert.rejects(stat(filePath), { code: 'ENOENT' });
    assert.equal(await firstStore.readToken(), null);
    await firstStore.clear();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rotating a protected token replaces the prior ciphertext atomically', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-rotation-'));
  const filePath = path.join(directory, 'player-token');
  const firstToken = '0123456789abcdef'.repeat(4);
  const secondToken = 'fedcba9876543210'.repeat(4);
  try {
    const store = createPlayerCredentialStore({ filePath });
    await store.writeToken(firstToken);
    const firstCiphertext = await readFile(filePath, 'utf8');
    await store.writeToken(secondToken);
    const secondCiphertext = await readFile(filePath, 'utf8');
    assert.notEqual(secondCiphertext, firstCiphertext);
    assert.equal(secondCiphertext.includes(firstToken), false);
    assert.equal(secondCiphertext.includes(secondToken), false);
    assert.equal(await store.readToken(), secondToken);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('persists only protected registration retry identity and conditionally clears the matching token', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-retry-'));
  const filePath = path.join(directory, 'player-token');
  const token = '0123456789abcdef'.repeat(4);
  const retryIdentity = `${'a'.repeat(64)}.${token}`;
  try {
    const first = createPlayerCredentialStore({ filePath });
    await first.writeToken(token);
    await first.writeRegistrationRetry?.(retryIdentity);
    const ciphertext = await readFile(filePath, 'utf8');
    assert.equal(ciphertext.includes(token), false);
    assert.equal(ciphertext.includes(retryIdentity), false);
    const restarted = createPlayerCredentialStore({ filePath });
    assert.equal(await restarted.readRegistrationRetry?.(), retryIdentity);
    await restarted.writeToken('fedcba9876543210'.repeat(4));
    await restarted.clearIfToken?.(token);
    assert.equal(await restarted.readToken(), 'fedcba9876543210'.repeat(4));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('serializes concurrent active token and pending registration identity mutations', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-serial-'));
  const filePath = path.join(directory, 'player-token');
  const activeToken = '0123456789abcdef'.repeat(4);
  const pendingIdentity = `${'a'.repeat(64)}.${'fedcba9876543210'.repeat(4)}`;
  try {
    const store = createPlayerCredentialStore({ filePath });
    await Promise.all([
      store.writeToken(activeToken),
      store.writeRegistrationRetry?.(pendingIdentity),
    ]);
    const restarted = createPlayerCredentialStore({ filePath });
    assert.equal(await restarted.readToken(), activeToken);
    assert.equal(await restarted.readRegistrationRetry?.(), pendingIdentity);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('conditionally clearing an active token preserves the pending registration identity', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-clear-pending-'));
  const filePath = path.join(directory, 'player-token');
  const activeToken = '0123456789abcdef'.repeat(4);
  const pendingIdentity = `${'a'.repeat(64)}.${'fedcba9876543210'.repeat(4)}`;
  try {
    const store = createPlayerCredentialStore({ filePath });
    await store.writeToken(activeToken);
    await store.writeRegistrationRetry?.(pendingIdentity);
    await store.clearIfToken?.(activeToken);
    const restarted = createPlayerCredentialStore({ filePath });
    assert.equal(await restarted.readToken(), null);
    assert.equal(await restarted.readRegistrationRetry?.(), pendingIdentity);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rejects a malformed credential file instead of treating it as a missing token', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-credentials-corrupt-'));
  const filePath = path.join(directory, 'player-token');
  try {
    await writeFile(filePath, 'plaintext-token', 'utf8');
    const store = createPlayerCredentialStore({ filePath, platform: 'win32' });
    await assert.rejects(store.readToken(), /corrupt/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects tokens outside the player token generator format', async () => {
  const store = createPlayerCredentialStore({ filePath: 'unused', platform: 'win32' });
  await assert.rejects(store.writeToken('not-a-player-token'), /token/i);
});

test('fails closed on unsupported platforms', async () => {
  const store = createPlayerCredentialStore({ filePath: 'unused', platform: 'linux' });
  await assert.rejects(store.readToken(), /Windows/i);
  await assert.rejects(store.writeToken('0123456789abcdef'.repeat(4)), /Windows/i);
  await assert.rejects(store.clear(), /Windows/i);
});

test('persists a stable hardware identity encrypted at rest across store instances', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'player-identity-'));
  const filePath = path.join(directory, 'player-identity.dpapi');
  try {
    const first = createPlayerIdentityStore({ filePath });
    const hardwareId = await first.getOrCreateHardwareId();
    assert.match(hardwareId, /^[0-9a-f-]{36}$/i);
    assert.equal(await createPlayerIdentityStore({ filePath }).getOrCreateHardwareId(), hardwareId);
    const ciphertext = await readFile(filePath, 'utf8');
    assert.ok(ciphertext.length > 0);
    assert.equal(ciphertext.includes(hardwareId), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rejects Player identity storage on unsupported platforms', async () => {
  const store = createPlayerIdentityStore({ filePath: 'unused', platform: 'linux' });
  await assert.rejects(store.getOrCreateHardwareId(), /Windows/i);
});
