/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Request, Response } from 'express';
import { isLoopbackAddress, isLoopbackBindHost, restrictAdminToLoopback } from '../src/admin-access.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getMeta, openDatabase, type DB } from '../src/db.js';

interface RunningApp {
  baseUrl: string;
  db: DB;
  server: http.Server;
  close(): Promise<void>;
}

interface JsonResponse {
  status: number;
  body: any;
  headers: Headers;
}

const rootDir = path.resolve(import.meta.dirname, '..');

async function startApp(tempDir: string, adminPassword: string, bindHost = '127.0.0.1'): Promise<RunningApp> {
  const dbPath = path.join(tempDir, 'auth.sqlite');
  const config = loadConfig({
    rootDir,
    dataDir: tempDir,
    dbPath,
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: false,
    adminPassword,
    sessionSecret: 'isolated-auth-session-secret',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  const server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, bindHost, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The isolated test server did not bind a port.');
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    db,
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}

async function request(
  app: RunningApp,
  route: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${app.baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

async function requestFromLanAddress(
  app: RunningApp,
  address: string,
  route: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<JsonResponse> {
  const listening = app.server.address();
  if (!listening || typeof listening === 'string') throw new Error('The isolated test server has no TCP port.');
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: address,
      localAddress: address,
      port: listening.port,
      path: route,
      method: options.method || 'GET',
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = null;
        if (text) {
          try { body = JSON.parse(text); } catch { body = text; }
        }
        resolve({ status: res.statusCode || 0, body, headers: new Headers(res.headers as HeadersInit) });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function lanIpv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const address of entries || []) {
      if (address.family !== 'IPv4' || address.internal || address.address.startsWith('169.254.')) continue;
      addresses.push(address.address);
    }
  }
  const preferredPattern = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const preferred = addresses.filter((address) => preferredPattern.test(address));
  return [...preferred, ...addresses.filter((address) => !preferred.includes(address))];
}

function firstLanIpv4(): string | undefined {
  return lanIpv4Addresses()[0];
}

async function login(app: RunningApp, password: string): Promise<{ response: JsonResponse; cookie: string }> {
  const response = await request(app, '/api/auth/login', { method: 'POST', body: { password } });
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  return { response, cookie: cookie || '' };
}

test('a new database uses the documented test default only when no environment password is supplied', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-new-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, '');
  apps.push(app);

  const wrong = await request(app, '/api/auth/login', { method: 'POST', body: { password: 'incorrect-value' } });
  assert.equal(wrong.status, 401);
  assert.doesNotMatch(JSON.stringify(wrong.body), /incorrect-value/);
  assert.match(getMeta(app.db, 'admin_password_hash') || '', /^scrypt\$/);
  assert.notEqual(getMeta(app.db, 'admin_password_hash'), '0000');

  const accepted = await login(app, '0000');
  assert.equal(accepted.response.status, 200);
  assert.ok(accepted.cookie.startsWith('signage_session='));

  const session = await request(app, '/api/auth/me', { cookie: accepted.cookie });
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.defaultPasswordWarning, true);
});

test('an empty pre-created database file still counts as a new first run', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-empty-db-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(tempDir, 'auth.sqlite'), Buffer.alloc(0));

  const app = await startApp(tempDir, '');
  apps.push(app);
  const accepted = await login(app, '0000');
  assert.equal(accepted.response.status, 200);
});

test('a stored database password is not replaced by a later environment value', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-existing-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const first = await startApp(tempDir, 'environment-password-before-restart');
  apps.push(first);
  const initialLogin = await login(first, 'environment-password-before-restart');
  assert.equal(initialLogin.response.status, 200);
  await first.close();

  const afterRestart = await startApp(tempDir, 'environment-password-after-restart');
  apps.push(afterRestart);
  const preserved = await login(afterRestart, 'environment-password-before-restart');
  const replacement = await login(afterRestart, 'environment-password-after-restart');
  assert.equal(preserved.response.status, 200);
  assert.equal(replacement.response.status, 401);
});

test('an existing pre-credential database keeps its prior development password when the environment is empty', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-legacy-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const legacyDb = openDatabase(path.join(tempDir, 'auth.sqlite'));
  legacyDb.close();

  const app = await startApp(tempDir, '');
  apps.push(app);
  const priorPassword = await login(app, 'gugak1234');
  const newTestDefault = await login(app, '0000');
  assert.equal(priorPassword.response.status, 200);
  assert.equal(newTestDefault.response.status, 401);
});

test('changing the password invalidates all prior sessions and survives a restart', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-change-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let app = await startApp(tempDir, 'initial-environment-password');
  apps.push(app);
  const firstSession = await login(app, 'initial-environment-password');
  const secondSession = await login(app, 'initial-environment-password');
  assert.equal(firstSession.response.status, 200);
  assert.equal(secondSession.response.status, 200);

  const incorrectCurrent = await request(app, '/api/auth/change-password', {
    method: 'POST',
    cookie: firstSession.cookie,
    body: {
      currentPassword: 'incorrect-current-password',
      newPassword: 'replacement-password',
      confirmPassword: 'replacement-password',
    },
  });
  assert.equal(incorrectCurrent.status, 400);
  assert.equal(incorrectCurrent.body.field, 'currentPassword');
  assert.doesNotMatch(JSON.stringify(incorrectCurrent.body), /incorrect-current-password/);

  const mismatch = await request(app, '/api/auth/change-password', {
    method: 'POST',
    cookie: firstSession.cookie,
    body: {
      currentPassword: 'initial-environment-password',
      newPassword: 'replacement-password',
      confirmPassword: 'different-replacement-password',
    },
  });
  assert.equal(mismatch.status, 400);

  const change = await request(app, '/api/auth/change-password', {
    method: 'POST',
    cookie: firstSession.cookie,
    body: {
      currentPassword: 'initial-environment-password',
      newPassword: 'replacement-password',
      confirmPassword: 'replacement-password',
    },
  });
  assert.equal(change.status, 200);
  assert.deepEqual(change.body, { ok: true });
  assert.doesNotMatch(JSON.stringify(change.body), /replacement-password|initial-environment-password/);
  assert.notEqual(getMeta(app.db, 'admin_password_hash'), 'replacement-password');

  const firstSessionAfterChange = await request(app, '/api/auth/me', { cookie: firstSession.cookie });
  const secondSessionAfterChange = await request(app, '/api/auth/me', { cookie: secondSession.cookie });
  const protectedRequestAfterChange = await request(app, '/api/devices', { cookie: secondSession.cookie });
  assert.equal(firstSessionAfterChange.body.authenticated, false);
  assert.equal(secondSessionAfterChange.body.authenticated, false);
  assert.equal(protectedRequestAfterChange.status, 401);

  const oldPassword = await login(app, 'initial-environment-password');
  const newPassword = await login(app, 'replacement-password');
  assert.equal(oldPassword.response.status, 401);
  assert.equal(newPassword.response.status, 200);
  await app.close();

  app = await startApp(tempDir, 'initial-environment-password');
  apps.push(app);
  const oldAfterRestart = await login(app, 'initial-environment-password');
  const newAfterRestart = await login(app, 'replacement-password');
  assert.equal(oldAfterRestart.response.status, 401);
  assert.equal(newAfterRestart.response.status, 200);
});

test('a fresh test-default installation allows administrator login and protected APIs from loopback', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-loopback-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, '');
  apps.push(app);

  const accepted = await login(app, '0000');
  assert.equal(accepted.response.status, 200);
  const devices = await request(app, '/api/devices', { cookie: accepted.cookie });
  assert.equal(devices.status, 200);
  const session = await request(app, '/api/auth/me', { cookie: accepted.cookie });
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.defaultPasswordWarning, true);
  const page = await fetch(`${app.baseUrl}/admin/`);
  assert.equal(page.status, 200);
  await page.text();
});

test('a fresh test-default installation rejects administrator login, sessions, and protected APIs from a LAN address', async (t) => {
  const lanAddress = firstLanIpv4();
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 address is available');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-lan-block-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, '', '0.0.0.0');
  apps.push(app);
  const local = await login(app, '0000');
  assert.equal(local.response.status, 200);

  const lanLogin = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: '0000' },
  });
  assert.equal(lanLogin.status, 403);
  assert.match(lanLogin.body.error, /PC/);

  const lanSession = await requestFromLanAddress(app, lanAddress, '/api/auth/me', { cookie: local.cookie });
  assert.equal(lanSession.status, 403);
  const lanDevices = await requestFromLanAddress(app, lanAddress, '/api/devices', { cookie: local.cookie });
  assert.equal(lanDevices.status, 403);
  const lanAdminPage = await requestFromLanAddress(app, lanAddress, '/admin/');
  assert.equal(lanAdminPage.status, 403);

  const lanHealth = await requestFromLanAddress(app, lanAddress, '/api/health');
  assert.equal(lanHealth.status, 200);
  assert.equal(lanHealth.body.ok, true);
  const lanPlayer = await requestFromLanAddress(app, lanAddress, '/player/');
  assert.equal(lanPlayer.status, 200);
});

test('changing the stored password enables LAN administration in the same server process', async (t) => {
  const lanAddress = firstLanIpv4();
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 address is available');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-lan-enable-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, '', '0.0.0.0');
  apps.push(app);
  const local = await login(app, '0000');
  assert.equal(local.response.status, 200);

  const change = await request(app, '/api/auth/change-password', {
    method: 'POST',
    cookie: local.cookie,
    body: {
      currentPassword: '0000',
      newPassword: 'lan-admin-password',
      confirmPassword: 'lan-admin-password',
    },
  });
  assert.equal(change.status, 200);
  const invalidated = await request(app, '/api/auth/me', { cookie: local.cookie });
  assert.equal(invalidated.body.authenticated, false);

  const lanLogin = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: 'lan-admin-password' },
  });
  assert.equal(lanLogin.status, 200);
  const lanCookie = lanLogin.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(lanCookie?.startsWith('signage_session='));
  const lanDevices = await requestFromLanAddress(app, lanAddress, '/api/devices', { cookie: lanCookie });
  assert.equal(lanDevices.status, 200);
  const lanAdminPage = await requestFromLanAddress(app, lanAddress, '/admin/');
  assert.equal(lanAdminPage.status, 200);

  const oldPassword = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: '0000' },
  });
  assert.equal(oldPassword.status, 401);
});

test('an existing non-default installation keeps LAN administrator access across a restart', async (t) => {
  const lanAddress = firstLanIpv4();
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 address is available');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-lan-existing-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, 'existing-non-default-password', '0.0.0.0');
  apps.push(app);

  const lanLogin = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: 'existing-non-default-password' },
  });
  assert.equal(lanLogin.status, 200);
  const lanCookie = lanLogin.headers.get('set-cookie')?.split(';', 1)[0];
  const lanDevices = await requestFromLanAddress(app, lanAddress, '/api/devices', { cookie: lanCookie });
  assert.equal(lanDevices.status, 200);
  await app.close();

  const restarted = await startApp(tempDir, '', '0.0.0.0');
  apps.push(restarted);
  const afterRestart = await requestFromLanAddress(restarted, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: 'existing-non-default-password' },
  });
  assert.equal(afterRestart.status, 200);
  const defaultPassword = await requestFromLanAddress(restarted, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: '0000' },
  });
  assert.equal(defaultPassword.status, 401);
});

test('forwarding headers cannot make a LAN peer look local during test-default setup', async (t) => {
  const lanAddress = firstLanIpv4();
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 address is available');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-proxy-headers-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const app = await startApp(tempDir, '', '0.0.0.0');
  apps.push(app);
  const spoofHeaders: Record<string, string> = {
    'X-Forwarded-For': '127.0.0.1',
    'X-Real-IP': '127.0.0.1',
    'X-Forwarded-Host': 'localhost',
    'X-Forwarded-Proto': 'http',
    Forwarded: 'for=127.0.0.1',
    Via: '1.1 localhost',
    'CF-Connecting-IP': '127.0.0.1',
    'True-Client-IP': '127.0.0.1',
  };

  const lanSpoof = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: '0000' },
    headers: spoofHeaders,
  });
  assert.equal(lanSpoof.status, 403);

  for (const [name, value] of Object.entries(spoofHeaders)) {
    const loopbackSpoof = await request(app, '/api/auth/login', {
      method: 'POST',
      body: { password: '0000' },
      headers: { [name]: value },
    });
    assert.equal(loopbackSpoof.status, 403, `${name} must not bypass the loopback policy`);
  }

  const plain = await login(app, '0000');
  assert.equal(plain.response.status, 200);
});

test('a legacy pre-credential database keeps its non-default password and LAN access', async (t) => {
  const lanAddress = firstLanIpv4();
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 address is available');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-auth-lan-legacy-'));
  const apps: RunningApp[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const legacyDb = openDatabase(path.join(tempDir, 'auth.sqlite'));
  legacyDb.close();

  const app = await startApp(tempDir, '', '0.0.0.0');
  apps.push(app);
  const lanLogin = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: 'gugak1234' },
  });
  assert.equal(lanLogin.status, 200);
  const defaultPassword = await requestFromLanAddress(app, lanAddress, '/api/auth/login', {
    method: 'POST',
    body: { password: '0000' },
  });
  assert.equal(defaultPassword.status, 401);
});

test('loopback address classification covers IPv4, IPv6, and mapped forms', () => {
  for (const address of ['127.0.0.1', '127.255.255.254', '::1', '::1%lo0', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of [undefined, '', '0.0.0.0', '10.0.0.1', '192.168.1.2', '::', '::ffff:192.168.1.2', 'localhost']) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
  assert.equal(isLoopbackBindHost('localhost'), true);
  assert.equal(isLoopbackBindHost('127.0.0.1'), true);
  assert.equal(isLoopbackBindHost('::1'), true);
  assert.equal(isLoopbackBindHost('0.0.0.0'), false);
  assert.equal(isLoopbackBindHost('192.168.1.2'), false);
});

test('the administrator network guard uses the socket peer and ignores forwarding headers', () => {
  const cases: Array<{
    name: string;
    isDefault: boolean;
    remoteAddress: string | undefined;
    headers?: Record<string, string>;
    allowed: boolean;
  }> = [
    { name: 'default + loopback', isDefault: true, remoteAddress: '127.0.0.1', allowed: true },
    { name: 'default + IPv6 loopback', isDefault: true, remoteAddress: '::1', allowed: true },
    { name: 'default + LAN', isDefault: true, remoteAddress: '192.168.1.20', allowed: false },
    { name: 'default + missing peer', isDefault: true, remoteAddress: undefined, allowed: false },
    { name: 'default + loopback behind proxy header', isDefault: true, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1' }, allowed: false },
    { name: 'default + LAN spoofing loopback', isDefault: true, remoteAddress: '192.168.1.20', headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' }, allowed: false },
    { name: 'changed + LAN', isDefault: false, remoteAddress: '192.168.1.20', allowed: true },
    { name: 'changed + LAN behind proxy header', isDefault: false, remoteAddress: '192.168.1.20', headers: { forwarded: 'for=127.0.0.1' }, allowed: true },
  ];

  for (const entry of cases) {
    let status = 0;
    let body: unknown;
    let nextCalled = false;
    const req = {
      socket: { remoteAddress: entry.remoteAddress },
      headers: entry.headers || {},
    } as unknown as Request;
    const res = {
      setHeader: () => res,
      status: (code: number) => { status = code; return res; },
      json: (value: unknown) => { body = value; return res; },
    } as unknown as Response;
    restrictAdminToLoopback(() => entry.isDefault)(req, res, () => { nextCalled = true; });
    if (entry.allowed) {
      assert.equal(nextCalled, true, entry.name);
      assert.equal(status, 0, entry.name);
    } else {
      assert.equal(nextCalled, false, entry.name);
      assert.equal(status, 403, entry.name);
      assert.ok(body && typeof body === 'object' && 'error' in body, entry.name);
    }
  }
});
