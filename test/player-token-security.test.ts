/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db.js';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

test('player tokens are hashed, migrated and enforced for manager media', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'player-token-security-'));
  const config: AppConfig = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'), dataDir: temp,
    dbPath: path.join(temp, 'manager.sqlite'), uploadDir: path.join(temp, 'uploads'),
    seedSamples: false, adminPassword: 'security-test', sessionSecret: 'security-test-session-secret', mode: 'lan', role: 'manager',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  let db: DB = openDatabase(config.dbPath);
  const server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (route: string, options: { method?: string; body?: unknown; token?: string } = {}) => {
    const response = await fetch(base + route, {
      method: options.method ?? 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { response, text: await response.text() };
  };
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close(); fs.rmSync(temp, { recursive: true, force: true });
  });

  const insertDevice = (id: string, code: string, hardware: string | null = null, token: string | null = null) => {
    db.prepare(`INSERT INTO devices(id,name,orientation,width,height,pairing_code,hardware_id,player_token,pairing_code_expires_at,created_at,updated_at)
      VALUES(?, ?, 'landscape', 1920, 1080, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(id, id, code, hardware, token, new Date(Date.now() + 10 * 60_000).toISOString());
  };

  await t.test('migrates existing plaintext credentials atomically and keeps them usable', async () => {
    const legacy = 'legacy-player-bearer-token';
    const legacyPath = path.join(temp, 'legacy.sqlite');
    const oldDb = openDatabase(legacyPath);
    oldDb.prepare(`INSERT INTO devices(id,name,orientation,width,height,pairing_code,hardware_id,player_token,created_at,updated_at)
      VALUES('legacy','legacy','landscape',1920,1080,'LEGACY','legacy-hardware',?,datetime('now'),datetime('now'))`).run(legacy);
    oldDb.close();
    const migratedDb = openDatabase(legacyPath);
    const row = migratedDb.prepare('SELECT player_token, player_token_hash FROM devices WHERE id = ?').get('legacy') as any;
    assert.equal(row.player_token, null);
    assert.equal(row.player_token_hash, sha256(legacy));
    migratedDb.close();
    insertDevice('legacy', 'LEGACY', 'legacy-hardware');
    db.prepare('UPDATE devices SET player_token_hash = ? WHERE id = ?').run(sha256(legacy), 'legacy');
    assert.equal((await call('/api/player/manifest', { token: legacy })).response.status, 200);
  });

  await t.test('new registration stores only a hash and re-registration rotates credentials', async () => {
    insertDevice('new-device', 'NEWCODE');
    const first = await call('/api/player/register', { method: 'POST', body: { code: 'NEWCODE', hardwareId: 'hardware-new-001' } });
    assert.equal(first.response.status, 200, first.text);
    const firstToken = JSON.parse(first.text).token;
    let row = db.prepare('SELECT player_token, player_token_hash FROM devices WHERE id = ?').get('new-device') as any;
    assert.equal(row.player_token, null); assert.equal(row.player_token_hash, sha256(firstToken));
    db.prepare('UPDATE devices SET pairing_code = ?, pairing_code_expires_at = ?, pairing_code_consumed_at = NULL WHERE id = ?')
      .run('NEWCOD2', new Date(Date.now() + 10 * 60_000).toISOString(), 'new-device');
    const second = await call('/api/player/register', { method: 'POST', body: { code: 'NEWCOD2', hardwareId: 'hardware-new-001' } });
    const secondToken = JSON.parse(second.text).token;
    assert.notEqual(secondToken, firstToken);
    assert.equal((await call('/api/player/manifest', { token: firstToken })).response.status, 401);
    assert.equal((await call('/api/player/manifest', { token: secondToken })).response.status, 200);
    db.prepare('UPDATE devices SET pairing_code = ?, pairing_code_expires_at = ?, pairing_code_consumed_at = NULL WHERE id = ?')
      .run('NEWCOD3', new Date(Date.now() + 10 * 60_000).toISOString(), 'new-device');
    const takeover = await call('/api/player/register', { method: 'POST', body: { code: 'NEWCOD3', hardwareId: 'hardware-new-002', takeover: true } });
    const takeoverToken = JSON.parse(takeover.text).token;
    assert.equal(takeover.response.status, 200);
    assert.equal((await call('/api/player/manifest', { token: secondToken })).response.status, 401);
    assert.equal((await call('/api/player/manifest', { token: takeoverToken })).response.status, 200);
    row = db.prepare('SELECT player_token, player_token_hash FROM devices WHERE id = ?').get('new-device') as any;
    assert.equal(row.player_token, null); assert.equal(row.player_token_hash, sha256(takeoverToken));
  });

  await t.test('manager media requires token and membership in the device current publication', async () => {
    const one = 'asset-one.png'; const two = 'asset-two.png'; const unpublished = 'asset-private.png';
    for (const name of [one, two, unpublished]) fs.writeFileSync(path.join(config.uploadDir, name), name);
    insertDevice('media-a', 'MEDIAA', 'hardware-media-a', 'unused');
    insertDevice('media-b', 'MEDIAB', 'hardware-media-b', 'unused-b');
    const snapshot = { defaultPlaylist: { items: [{ content: { url: `/media/${one}` } }] }, schedules: [], wall: { screens: [{ playlist: { items: [{ content: { url: `/media/${one}` } }] } }] } };
    db.prepare('INSERT INTO publications(id,device_id,version,snapshot,published_at) VALUES(?,?,?,?,datetime(\'now\'))').run('pub-a', 'media-a', 1, JSON.stringify(snapshot));
    db.prepare('UPDATE devices SET published_version = 1 WHERE id = ?').run('media-a');
    db.prepare('INSERT INTO publications(id,device_id,version,snapshot,published_at) VALUES(?,?,?,?,datetime(\'now\'))').run('pub-b', 'media-b', 1, JSON.stringify({ defaultPlaylist: { items: [{ content: { url: `/media/${two}` } }] }, schedules: [], wall: null }));
    db.prepare('UPDATE devices SET published_version = 1 WHERE id = ?').run('media-b');
    const regA = await call('/api/player/register', { method: 'POST', body: { code: 'MEDIAA', hardwareId: 'hardware-media-a' } });
    const tokenA = JSON.parse(regA.text).token;
    assert.equal((await call(`/media/${one}`)).response.status, 401);
    const allowed = await call(`/media/${one}`, { token: tokenA });
    assert.equal(allowed.response.status, 200); assert.equal(allowed.text, one);
    assert.equal(allowed.response.headers.get('cache-control'), 'private, no-store');
    const range = await fetch(base + `/media/${one}`, { headers: { Authorization: `Bearer ${tokenA}`, Range: 'bytes=0-4' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 0-4/13');
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.equal((await call(`/media/${two}`, { token: tokenA })).response.status, 403);
    assert.equal((await call(`/media/${unpublished}`, { token: tokenA })).response.status, 403);
    assert.notEqual((await call('/media/%2e%2e/package.json', { token: tokenA })).response.status, 200);
    db.prepare('UPDATE publications SET snapshot = ? WHERE device_id = ? AND version = 1').run(JSON.stringify({ defaultPlaylist: null, schedules: [] }), 'media-a');
    assert.equal((await call(`/media/${one}`, { token: tokenA })).response.status, 403);
  });
});

test('standalone keeps compatibility with public static media', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'player-token-standalone-'));
  const config = loadConfig({ rootDir: path.resolve(import.meta.dirname, '..'), dataDir: temp, dbPath: path.join(temp, 'db.sqlite'), uploadDir: path.join(temp, 'uploads'), seedSamples: false });
  fs.mkdirSync(config.uploadDir, { recursive: true }); fs.writeFileSync(path.join(config.uploadDir, 'public.txt'), 'public');
  const db = openDatabase(config.dbPath); const server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${address.port}/media/public.txt`);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'public');
});
