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

interface JsonResponse {
  status: number;
  body: any;
  headers: Headers;
}

let server: http.Server;
let db: DB;
let config: AppConfig;
let baseUrl: string;
let tempDir: string;
let cookie = '';
const created = {
  imageId: '',
  videoId: '',
  urlId: '',
  playlistId: '',
  deviceId: '',
  pairingCode: '',
  playerToken: '',
};

async function request(
  route: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; cookieValue?: string } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.cookieValue) headers.Cookie = options.cookieValue;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${route}`, { method: options.method || 'GET', headers, body });
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function admin(route: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return request(route, { ...options, cookieValue: cookie });
}

function player(route: string, options: { method?: string; body?: unknown } = {}) {
  return request(route, {
    ...options,
    headers: { Authorization: `Bearer ${created.playerToken}` },
  });
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-signage-test-'));
  config = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'),
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: false,
    adminPassword: 'test-password',
    sessionSecret: 'test-session-secret-with-enough-length',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  db = openDatabase(config.dbPath);
  const app = createApp(db, config);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('테스트 서버 포트를 얻지 못했습니다.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('관리 서버 API 핵심 흐름', async (t) => {
  await t.test('상태 확인과 관리자 인증', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const blocked = await request('/api/devices');
    assert.equal(blocked.status, 401);

    const playerConfig = await request('/api/player/config');
    assert.equal(playerConfig.status, 200);
    assert.equal(playerConfig.body.adminDevicesUrl, '/admin/#/devices');
    assert.equal(playerConfig.body.sampleMode, false);
    assert.equal(playerConfig.body.demoDefaultPassword, false);

    const wrong = await request('/api/auth/login', { method: 'POST', body: { password: 'wrong' } });
    assert.equal(wrong.status, 401);

    const login = await request('/api/auth/login', { method: 'POST', body: { password: 'test-password' } });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie?.includes('signage_session='));
    cookie = setCookie!.split(';')[0]!;

    const me = await admin('/api/auth/me');
    assert.equal(me.body.authenticated, true);
  });

  await t.test('이미지·동영상 업로드와 URL 콘텐츠 추가', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const imageForm = new FormData();
    imageForm.append('files', new Blob([fs.readFileSync(path.join(root, 'seed', 'poster-autumn.png'))], { type: 'image/png' }), 'poster.png');
    const imageUpload = await request('/api/contents', { method: 'POST', body: imageForm, cookieValue: cookie });
    assert.equal(imageUpload.status, 201, JSON.stringify(imageUpload.body));
    assert.equal(imageUpload.body.contents.length, 1);
    assert.equal(imageUpload.body.contents[0].kind, 'image');
    assert.equal(imageUpload.body.contents[0].width, 1920);
    created.imageId = imageUpload.body.contents[0].id;

    const videoForm = new FormData();
    videoForm.append('files', new Blob([fs.readFileSync(path.join(root, 'seed', 'sample-video.mp4'))], { type: 'video/mp4' }), 'sample.mp4');
    const videoUpload = await request('/api/contents', { method: 'POST', body: videoForm, cookieValue: cookie });
    assert.equal(videoUpload.status, 201, JSON.stringify(videoUpload.body));
    assert.equal(videoUpload.body.contents[0].kind, 'video');
    created.videoId = videoUpload.body.contents[0].id;

    const url = await admin('/api/contents/url', {
      method: 'POST',
      body: { name: '안내 페이지', url: 'https://example.com/notice' },
    });
    assert.equal(url.status, 201);
    created.urlId = url.body.content.id;

    const listed = await admin('/api/contents');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.contents.length, 3);
  });

  await t.test('잘못된 파일과 URL은 거부한다', async () => {
    const badForm = new FormData();
    badForm.append('files', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'fake.png');
    const bad = await request('/api/contents', { method: 'POST', body: badForm, cookieValue: cookie });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /형식/);

    const badUrl = await admin('/api/contents/url', {
      method: 'POST',
      body: { name: '위험한 주소', url: 'javascript:alert(1)' },
    });
    assert.equal(badUrl.status, 400);

    const rejected = await request('/api/contents', { method: 'POST', body: new FormData() });
    assert.equal(rejected.status, 401);
  });

  await t.test('기기 등록과 등록 코드 바인딩', async () => {
    const create = await admin('/api/devices', {
      method: 'POST',
      body: { name: '테스트 로비', location: '1층', orientation: 'portrait', width: 1080, height: 1920 },
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.match(create.body.device.pairingCode, /^[A-Z2-9]{6}$/);
    assert.equal(create.body.device.status, 'pending');
    created.deviceId = create.body.device.id;
    created.pairingCode = create.body.device.pairingCode;

    const wrongCode = await request('/api/player/register', {
      method: 'POST',
      body: { code: 'ZZZZZZ', hardwareId: 'hardware-0001' },
    });
    assert.equal(wrongCode.status, 404);
    assert.match(wrongCode.body.error, /관리 화면/);

    const register = await request('/api/player/register', {
      method: 'POST',
      body: { code: created.pairingCode, hardwareId: 'hardware-0001', screen: { width: 1080, height: 1920 } },
    });
    assert.equal(register.status, 200, JSON.stringify(register.body));
    assert.ok(register.body.token.length > 30);
    created.playerToken = register.body.token;
    assert.equal(register.body.device.id, created.deviceId);

    const secondHardware = await request('/api/player/register', {
      method: 'POST',
      body: { code: created.pairingCode, hardwareId: 'hardware-0002' },
    });
    assert.equal(secondHardware.status, 409);
    assert.match(secondHardware.body.error, /기존 연결/);

    const devices = await admin('/api/devices');
    assert.equal(devices.body.devices[0].paired, true);
    assert.equal(devices.body.devices[0].reportedWidth, 1080);
  });

  await t.test('재생목록 저장, 기기 배정, 게시와 재생기 조회', async () => {
    const playlist = await admin('/api/playlists', {
      method: 'POST',
      body: { name: '검증 재생목록', description: '이미지·동영상·URL 순환' },
    });
    assert.equal(playlist.status, 201);
    created.playlistId = playlist.body.playlist.id;

    const update = await admin(`/api/playlists/${created.playlistId}`, {
      method: 'PUT',
      body: {
        name: '검증 재생목록',
        description: '이미지·동영상·URL 순환',
        items: [
          { contentId: created.imageId, durationSeconds: 5, fitMode: 'contain', transitionMs: 300, enabled: true },
          { contentId: created.videoId, durationSeconds: 10, fitMode: 'cover', transitionMs: 300, enabled: true },
          { contentId: created.urlId, durationSeconds: 8, fitMode: 'contain', transitionMs: 0, enabled: true },
        ],
      },
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));
    assert.equal(update.body.items.length, 3);
    assert.equal(update.body.items[1].content.kind, 'video');

    const assignment = await admin(`/api/devices/${created.deviceId}/assignment`, {
      method: 'PUT',
      body: { playlistId: created.playlistId, schedules: [] },
    });
    assert.equal(assignment.status, 200);

    const publish = await admin(`/api/devices/${created.deviceId}/publish`, { method: 'POST' });
    assert.equal(publish.status, 200, JSON.stringify(publish.body));
    assert.equal(publish.body.version, 1);

    const manifest = await player('/api/player/manifest');
    assert.equal(manifest.status, 200);
    const value = manifest.body.manifest;
    assert.equal(value.version, 1);
    assert.equal(value.defaultPlaylist.items.length, 3);
    assert.match(value.defaultPlaylist.items[0].content.url, /^\/media\//);
    assert.equal(value.defaultPlaylist.items[2].content.url, 'https://example.com/notice');
    assert.equal(value.device.orientation, 'portrait');
  });

  await t.test('시간표 저장·게시와 하트비트 상태', async () => {
    const assignment = await admin(`/api/devices/${created.deviceId}/assignment`, {
      method: 'PUT',
      body: {
        playlistId: created.playlistId,
        schedules: [{
          playlistId: created.playlistId,
          days: [1, 2, 3, 4, 5],
          startTime: '09:00',
          endTime: '18:00',
          enabled: true,
        }],
      },
    });
    assert.equal(assignment.status, 200, JSON.stringify(assignment.body));

    const badSchedule = await admin(`/api/devices/${created.deviceId}/assignment`, {
      method: 'PUT',
      body: { playlistId: created.playlistId, schedules: [{ playlistId: created.playlistId, days: [], startTime: '25:00', endTime: '18:00' }] },
    });
    assert.equal(badSchedule.status, 400);

    const publish = await admin(`/api/devices/${created.deviceId}/publish`, { method: 'POST' });
    assert.equal(publish.body.version, 2);

    const manifest = await player('/api/player/manifest');
    assert.equal(manifest.body.manifest.schedules.length, 1);
    assert.deepEqual(manifest.body.manifest.schedules[0].days, [1, 2, 3, 4, 5]);

    const heartbeat = await player('/api/player/heartbeat', {
      method: 'POST',
      body: { state: 'playing', currentContentId: created.imageId },
    });
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.body.ok, true);

    const devices = await admin('/api/devices');
    assert.equal(devices.body.devices[0].status, 'online');
    assert.equal(devices.body.devices[0].playerState, `playing:${created.imageId}`);
    assert.equal(devices.body.devices[0].publishedVersion, 2);
  });

  await t.test('등록 코드로 기존 연결을 인수하고 이전 토큰을 무효화한다', async () => {
    const oldToken = created.playerToken;
    const takeover = await request('/api/player/register', {
      method: 'POST',
      body: { code: created.pairingCode, hardwareId: 'hardware-0003', takeover: true, screen: { width: 1920, height: 1080 } },
    });
    assert.equal(takeover.status, 200, JSON.stringify(takeover.body));
    assert.notEqual(takeover.body.token, oldToken);

    const stale = await request('/api/player/manifest', {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    assert.equal(stale.status, 401);

    created.playerToken = takeover.body.token;
    const fresh = await player('/api/player/manifest');
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.manifest.version, 2);
  });

  await t.test('사용 중 콘텐츠 삭제와 잘못된 연결 해제를 막는다', async () => {
    const removeContent = await admin(`/api/contents/${created.imageId}`, { method: 'DELETE' });
    assert.equal(removeContent.status, 409);
    assert.match(removeContent.body.error, /사용 중/);

    const removePlaylist = await admin(`/api/playlists/${created.playlistId}`, { method: 'DELETE' });
    assert.equal(removePlaylist.status, 409);

    const unpair = await admin(`/api/devices/${created.deviceId}/unpair`, { method: 'POST' });
    assert.equal(unpair.status, 200);
    const staleManifest = await player('/api/player/manifest');
    assert.equal(staleManifest.status, 401);

    const regenerate = await admin(`/api/devices/${created.deviceId}/regenerate-code`, { method: 'POST' });
    assert.equal(regenerate.status, 200);
    assert.notEqual(regenerate.body.device.pairingCode, created.pairingCode);
  });
});
