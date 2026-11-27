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

test('LAN pairing codes expire, are single-use, and rate-limit failures without storing addresses', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pairing-code-security-'));
  const sessionSecret = 'pairing-test-session-secret';
  const config: AppConfig = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'), dataDir: temp, dbPath: path.join(temp, 'db.sqlite'),
    uploadDir: path.join(temp, 'uploads'), seedSamples: false, adminPassword: 'pairing-test-password',
    sessionSecret, mode: 'lan', role: 'manager',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db: DB = openDatabase(config.dbPath);
  const server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (route: string, options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) => {
    const response = await fetch(base + route, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.ip ? { 'X-Forwarded-For': options.ip } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text(); let body: any = text;
    try { body = JSON.parse(text); } catch { /* response is not JSON */ }
    return { response, body };
  };
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

  const login = await call('/api/auth/login', { method: 'POST', body: { password: 'pairing-test-password' } });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0]!;
  const created = await call('/api/devices', { method: 'POST', cookie, body: { name: 'Pairing test device' } });
  assert.equal(created.response.status, 201);
  const deviceId = created.body.device.id as string;
  let code = created.body.device.pairingCode as string;
  assert.ok(created.body.device.pairingCodeExpiresAt, 'network device DTO exposes pairing expiry');
  db.prepare(`INSERT INTO devices(id,name,orientation,width,height,pairing_code,created_at,updated_at)
    VALUES('dev-sample-lobby','Sample','landscape',1920,1080,'SAMPLE',datetime('now'),datetime('now'))`).run();
  const playerConfig = await call('/api/player/config');
  assert.equal(playerConfig.body.sampleCode, null);
  assert.equal(playerConfig.body.sampleMode, false);

  await t.test('rejects a legacy code without expiry and omits sample codes on invalid input', async () => {
    db.prepare('UPDATE devices SET pairing_code_expires_at = NULL WHERE id = ?').run(deviceId);
    const invalid = await call('/api/player/register', { method: 'POST', body: { code: 'BADBAD', hardwareId: 'hardware-pair-001' } });
    assert.equal(invalid.response.status, 404);
    assert.equal('sampleCode' in invalid.body, false);
    const legacy = await call('/api/player/register', { method: 'POST', body: { code, hardwareId: 'hardware-pair-001' } });
    assert.equal(legacy.response.status, 404);
    assert.equal('sampleCode' in legacy.body, false);
  });

  await t.test('blocks repeated failures by keyed address hash and stores no raw address', async () => {
    const ip = '198.51.100.44';
    for (let i = 0; i < 5; i += 1) {
      const failed = await call('/api/player/register', { method: 'POST', ip, body: { code: `BAD${i}XX`, hardwareId: 'hardware-pair-002' } });
      assert.equal(failed.response.status, 404);
    }
    const blocked = await call('/api/player/register', { method: 'POST', ip, body: { code: 'BADBAD', hardwareId: 'hardware-pair-003' } });
    assert.equal(blocked.response.status, 429);
    const key = crypto.createHmac('sha256', sessionSecret).update(ip).digest('hex');
    const row = db.prepare('SELECT client_key_hash, failed_count, blocked_until FROM player_pairing_attempts WHERE client_key_hash = ?').get(key) as any;
    assert.equal(row.failed_count, 5); assert.ok(row.blocked_until);
    assert.equal(JSON.stringify(row).includes(ip), false);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM player_pairing_attempts WHERE client_key_hash = ?').get(ip) as any).n, 0);
  });

  await t.test('regeneration starts a fresh lifetime; conflicts preserve the code; success consumes it once', async () => {
    const regenerated = await call(`/api/devices/${encodeURIComponent(deviceId)}/regenerate-code`, { method: 'POST', cookie });
    assert.equal(regenerated.response.status, 200);
    code = regenerated.body.device.pairingCode;
    const expiry = Date.parse(regenerated.body.device.pairingCodeExpiresAt);
    assert.ok(expiry > Date.now() && expiry <= Date.now() + 10 * 60_000 + 5_000);
    const paired = await call('/api/player/register', { method: 'POST', body: { code, hardwareId: 'hardware-pair-010' } });
    assert.equal(paired.response.status, 200);
    const consumed = db.prepare('SELECT pairing_code_consumed_at FROM devices WHERE id = ?').get(deviceId) as any;
    assert.ok(consumed.pairing_code_consumed_at);
    const repeat = await call('/api/player/register', { method: 'POST', body: { code, hardwareId: 'hardware-pair-010' } });
    assert.equal(repeat.response.status, 404);
    assert.equal('sampleCode' in repeat.body, false);
  });

  await t.test('a Player Host can safely retry registration with its already-persisted token', async () => {
    const regenerated = await call(`/api/devices/${encodeURIComponent(deviceId)}/regenerate-code`, { method: 'POST', cookie });
    const retryCode = regenerated.body.device.pairingCode as string;
    const playerToken = 'b'.repeat(64);
    const registration = { code: retryCode, hardwareId: 'hardware-pair-retry', playerToken };
    const first = await call('/api/player/register', { method: 'POST', body: registration });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.token, playerToken);
    assert.equal(first.body.device.id, deviceId);
    assert.ok((db.prepare('SELECT pairing_code_consumed_at FROM devices WHERE id = ?').get(deviceId) as any).pairing_code_consumed_at);

    const retry = await call('/api/player/register', { method: 'POST', body: registration });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.token, playerToken);
    assert.equal(retry.body.device.id, deviceId);
    const foreignRetry = await call('/api/player/register', {
      method: 'POST', body: { ...registration, hardwareId: 'hardware-pair-other', playerToken: 'c'.repeat(64) },
    });
    assert.equal(foreignRetry.response.status, 404);
  });

  await t.test('expires after ten minutes and a takeover conflict does not consume the code', async () => {
    const regenerated = await call(`/api/devices/${encodeURIComponent(deviceId)}/regenerate-code`, { method: 'POST', cookie });
    code = regenerated.body.device.pairingCode;
    db.prepare('UPDATE devices SET hardware_id = ? WHERE id = ?').run('hardware-already-paired', deviceId);
    const conflict = await call('/api/player/register', { method: 'POST', body: { code, hardwareId: 'hardware-pair-other' } });
    assert.equal(conflict.response.status, 409);
    assert.equal((db.prepare('SELECT pairing_code_consumed_at FROM devices WHERE id = ?').get(deviceId) as any).pairing_code_consumed_at, null);
    db.prepare("UPDATE devices SET pairing_code_expires_at = datetime('now', '-1 second') WHERE id = ?").run(deviceId);
    const expired = await call('/api/player/register', { method: 'POST', body: { code, hardwareId: 'hardware-pair-other', takeover: true } });
    assert.equal(expired.response.status, 404);
  });
});

test('all/standalone pairing remains reusable and has no expiry', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pairing-standalone-'));
  const config = loadConfig({ rootDir: path.resolve(import.meta.dirname, '..'), dataDir: temp, dbPath: path.join(temp, 'db.sqlite'), uploadDir: path.join(temp, 'uploads'), seedSamples: false });
  fs.mkdirSync(config.uploadDir, { recursive: true }); const db = openDatabase(config.dbPath);
  const server = http.createServer(createApp(db, config)); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  db.prepare(`INSERT INTO devices(id,name,orientation,width,height,pairing_code,created_at,updated_at) VALUES('standalone','Standalone','landscape',1920,1080,'STAND1',datetime('now'),datetime('now'))`).run();
  for (const hardwareId of ['hardware-standalone-01', 'hardware-standalone-01']) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/player/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'STAND1', hardwareId }) });
    assert.equal(response.status, 200);
  }
  assert.equal((db.prepare('SELECT pairing_code_expires_at FROM devices WHERE id = ?').get('standalone') as any).pairing_code_expires_at, null);
});
