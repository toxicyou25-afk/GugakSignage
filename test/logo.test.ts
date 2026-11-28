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

async function request(route: string, options: { method?: string; body?: unknown; cookieValue?: string } = {}) {
  const headers: Record<string, string> = {};
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers['X-Gugak-Request'] = '1';
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.cookieValue) headers.Cookie = options.cookieValue;
  const response = await fetch(`${baseUrl}${route}`, { method: options.method || 'GET', headers, body });
  return { response, body: await response.json() as { dataUrl?: string | null; error?: string } };
}

function admin(route: string, options: { method?: string; body?: unknown } = {}) {
  return request(route, { ...options, cookieValue: cookie });
}

function uploadLogo(filename: string, bytes: Uint8Array, mime: string) {
  const form = new FormData();
  form.append('logo', new Blob([bytes], { type: mime }), filename);
  return admin('/api/settings/logo', { method: 'PUT', body: form });
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-logo-test-'));
  config = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'),
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: false,
    adminPassword: 'test-password',
    sessionSecret: 'test-logo-session-secret-with-enough-length',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await startServer();
  await login();
});

after(async () => {
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('로고 조회·등록·삭제는 관리자 인증이 필요하다', async () => {
  const read = await request('/api/settings/logo');
  const write = await request('/api/settings/logo', { method: 'PUT', body: new FormData() });
  const remove = await request('/api/settings/logo', { method: 'DELETE' });
  assert.equal(read.response.status, 401);
  assert.equal(write.response.status, 401);
  assert.equal(remove.response.status, 401);
});

test('PNG·JPEG 로고 등록, 교체, 재시작 유지, 삭제를 지원한다', async () => {
  const rootDir = path.resolve(import.meta.dirname, '..');
  const png = fs.readFileSync(path.join(rootDir, 'seed', 'poster-welcome.png'));
  const jpeg = fs.readFileSync(path.join(rootDir, 'test', 'fixtures', 'logo.jpg'));

  const savedPng = await uploadLogo('logo.png', png, 'image/png');
  assert.equal(savedPng.response.status, 200, JSON.stringify(savedPng.body));
  assert.equal(savedPng.body.dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  const savedJpeg = await uploadLogo('logo.jpg', jpeg, 'image/jpeg');
  assert.equal(savedJpeg.response.status, 200, JSON.stringify(savedJpeg.body));
  assert.equal(savedJpeg.body.dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);

  await stopServer();
  await startServer();
  await login();
  const afterRestart = await admin('/api/settings/logo');
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.dataUrl, savedJpeg.body.dataUrl);

  const removed = await admin('/api/settings/logo', { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.dataUrl, null);
  assert.equal((await admin('/api/settings/logo')).body.dataUrl, null);
});

test('잘린 이미지나 잘못된 형식은 기존 로고를 유지한 채 거부한다', async () => {
  const rootDir = path.resolve(import.meta.dirname, '..');
  const png = fs.readFileSync(path.join(rootDir, 'seed', 'poster-welcome.png'));
  const saved = await uploadLogo('logo.png', png, 'image/png');
  assert.equal(saved.response.status, 200);

  const truncated = await uploadLogo('broken.png', png.subarray(0, 100), 'image/png');
  assert.equal(truncated.response.status, 400);
  const jpeg = fs.readFileSync(path.join(rootDir, 'test', 'fixtures', 'logo.jpg'));
  const truncatedJpeg = await uploadLogo('broken.jpg', jpeg.subarray(0, jpeg.length - 2), 'image/jpeg');
  assert.equal(truncatedJpeg.response.status, 400);
  const svg = await uploadLogo('logo.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
  assert.equal(svg.response.status, 400);
  assert.equal((await admin('/api/settings/logo')).body.dataUrl, saved.body.dataUrl);
});

test('로고는 512 KiB와 2048×2048 제한을 적용한다', async () => {
  const oversized = await uploadLogo('large.png', new Uint8Array(512 * 1024 + 1), 'image/png');
  assert.equal(oversized.response.status, 400);

  const rootDir = path.resolve(import.meta.dirname, '..');
  const png = fs.readFileSync(path.join(rootDir, 'seed', 'poster-welcome.png'));
  const tooWide = Buffer.from(png);
  tooWide.writeUInt32BE(2049, 16);
  const oversizedDimensions = await uploadLogo('wide.png', tooWide, 'image/png');
  assert.equal(oversizedDimensions.response.status, 400);
});
