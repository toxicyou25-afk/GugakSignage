/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db.js';

let server: http.Server;
let db: DB;
let config: AppConfig;
let baseUrl: string;
let tempDir: string;
let cookie = '';

async function request(
  route: string,
  options: { method?: string; body?: unknown; cookieValue?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers['X-Gugak-Request'] = '1';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookieValue) headers.Cookie = options.cookieValue;
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, body: await response.json() as { name?: string; error?: string } };
}

function admin(route: string, options: { method?: string; body?: unknown } = {}) {
  return request(route, { ...options, cookieValue: cookie });
}

async function startServer() {
  db = openDatabase(config.dbPath);
  server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('테스트 서버 포트를 얻지 못했습니다.');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  db?.close();
}

async function login() {
  const { response } = await request('/api/auth/login', { method: 'POST', body: { password: 'test-password' } });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-settings-test-'));
  config = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'),
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: false,
    adminPassword: 'test-password',
    sessionSecret: 'test-settings-session-secret-with-enough-length',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await startServer();
  await login();
});

after(async () => {
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('기관명 조회와 변경은 관리자 인증이 필요하다', async () => {
  const read = await request('/api/settings/institution');
  const write = await request('/api/settings/institution', { method: 'PUT', body: { name: '안내센터' } });
  assert.equal(read.response.status, 401);
  assert.equal(write.response.status, 401);
});

test('기관명 저장은 공백을 정리하고 관리자 조회에 반영한다', async () => {
  const saved = await admin('/api/settings/institution', { method: 'PUT', body: { name: '  열린 안내센터  ' } });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.name, '열린 안내센터');

  const read = await admin('/api/settings/institution');
  assert.equal(read.response.status, 200);
  assert.equal(read.body.name, '열린 안내센터');
  assert.equal(read.response.headers.get('cache-control'), 'no-store');
});

test('기관명은 C0·C1 제어문자를 거부하고 기존 값을 유지한다', async () => {
  const before = await admin('/api/settings/institution');
  try {
    const invalid = await admin('/api/settings/institution', { method: 'PUT', body: { name: '안내\u0085센터' } });
    assert.equal(invalid.response.status, 400);

    const read = await admin('/api/settings/institution');
    assert.equal(read.body.name, before.body.name);
  } finally {
    await admin('/api/settings/institution', { method: 'PUT', body: { name: before.body.name } });
  }
});

test('기관명은 100자를 넘거나 문자열이 아니면 거부한다', async () => {
  for (const name of ['가'.repeat(101), { value: '안내센터' }, null]) {
    const invalid = await admin('/api/settings/institution', { method: 'PUT', body: { name } });
    assert.equal(invalid.response.status, 400);
  }
});

test('기관명은 데이터베이스 재개방 후에도 유지된다', async () => {
  await stopServer();
  await startServer();
  await login();

  const read = await admin('/api/settings/institution');
  assert.equal(read.response.status, 200);
  assert.equal(read.body.name, '열린 안내센터');
});
