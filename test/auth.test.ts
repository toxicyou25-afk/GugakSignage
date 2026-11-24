/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

async function startApp(tempDir: string, adminPassword: string): Promise<RunningApp> {
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
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
