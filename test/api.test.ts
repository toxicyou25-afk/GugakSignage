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
    const blockedTopology = await request('/api/sites');
    assert.equal(blockedTopology.status, 401);

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

    const nativeMonitors = await request('/api/native-monitors');
    assert.equal(nativeMonitors.status, 401);

    const nativeMonitorStatus = await admin('/api/native-monitors');
    assert.equal(nativeMonitorStatus.status, 200);
    assert.equal(typeof nativeMonitorStatus.body.supported, 'boolean');
    assert.ok(Array.isArray(nativeMonitorStatus.body.monitors));
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
    assert.equal(db.prepare('SELECT last_host_local FROM devices WHERE id = ?').get(created.deviceId)?.last_host_local, 1);

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

  await t.test('관리자 전용 재생기 실행·중지 제어 요청을 기록한다', async () => {
    const initial = await admin('/api/player/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.player.desired, 'stopped');
    assert.equal(initial.body.player.running, false);

    const unauth = await request('/api/player/state');
    assert.equal(unauth.status, 401);

    const badDevice = await admin('/api/player/launch', { method: 'POST', body: { deviceId: 'missing' } });
    assert.equal(badDevice.status, 404);

    const launch = await admin('/api/player/launch', { method: 'POST', body: { deviceId: created.deviceId } });
    assert.equal(launch.status, 202, JSON.stringify(launch.body));
    assert.equal(launch.body.accepted, true);
    assert.match(launch.body.playerUrl, /^http:\/\/127\.0\.0\.1:\d+\/player\/\?code=/);
    const commandPath = path.join(config.dataDir, 'control', 'player-command.json');
    const command = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
    assert.equal(command.action, 'launch');
    assert.equal(command.deviceId, created.deviceId);
    assert.equal(command.playerUrl, launch.body.playerUrl);
    const serverInstance = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'control', 'server-instance.json'), 'utf8'));
    assert.equal(command.serverInstanceId, serverInstance.id);
    assert.equal(serverInstance.pid, process.pid);

    const stop = await admin('/api/player/stop', { method: 'POST' });
    assert.equal(stop.status, 202);
    const stopCommand = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
    assert.equal(stopCommand.action, 'stop');
    fs.rmSync(commandPath, { force: true });
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
      body: { state: 'playing', currentContentId: created.imageId, playerVersion: 'test-1', manifestVersion: 1, cacheReady: true },
    });
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.body.ok, true);
    assert.equal(heartbeat.body.reconnected, false);

    const devices = await admin('/api/devices');
    assert.equal(devices.body.devices[0].status, 'online');
    assert.equal(devices.body.devices[0].playerState, `playing:${created.imageId}`);
    assert.equal(devices.body.devices[0].publishedVersion, 2);
    assert.equal(devices.body.devices[0].playerVersion, 'test-1');
    assert.equal(devices.body.devices[0].manifestVersion, 1);
    assert.equal(devices.body.devices[0].manifestBehind, true);
    assert.equal(devices.body.devices[0].cacheReady, true);
    assert.equal(devices.body.devices[0].health, 'online');
    assert.equal(devices.body.devices[0].attention, true);
    assert.equal(devices.body.devices[0].reconnectCount, 0);

    // Simulate a player returning after the configured online window; the
    // disconnect is counted once, and ordinary subsequent heartbeats do not
    // inflate the recovery counter.
    db.prepare("UPDATE devices SET last_seen = ?, last_heartbeat_at = ? WHERE id = ?")
      .run(new Date(Date.now() - config.heartbeatOnlineMs - 1_000).toISOString(),
        new Date(Date.now() - config.heartbeatOnlineMs - 1_000).toISOString(), created.deviceId);
    const recovered = await player('/api/player/heartbeat', { method: 'POST', body: { state: 'playing' } });
    assert.equal(recovered.body.reconnected, true);
    assert.equal(recovered.body.reconnectCount, 1);
    const steady = await player('/api/player/heartbeat', { method: 'POST', body: { state: 'playing' } });
    assert.equal(steady.body.reconnected, false);
    assert.equal(steady.body.reconnectCount, 1);

    // Manifest polling may keep last_seen fresh while the heartbeat loop is
    // stalled; recovery must still be detected from last_heartbeat_at.
    db.prepare('UPDATE devices SET last_seen = ?, last_heartbeat_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date(Date.now() - config.heartbeatOnlineMs - 1_000).toISOString(), created.deviceId);
    const staleRecovery = await player('/api/player/heartbeat', { method: 'POST', body: { state: 'playing' } });
    assert.equal(staleRecovery.body.reconnected, true);
    assert.equal(staleRecovery.body.reconnectCount, 2);
    const recoveredDevice = (await admin('/api/devices')).body.devices[0];
    assert.equal(recoveredDevice.heartbeatAgeMs < 1_000, true);
    assert.equal(recoveredDevice.health, 'online');
    assert.equal(recoveredDevice.status, 'online');
    db.prepare("UPDATE devices SET player_state = ?, cache_ready = 1 WHERE id = ?").run(`offline:${created.imageId}`, created.deviceId);
    const unhealthyDevice = (await admin('/api/devices')).body.devices[0];
    assert.equal(unhealthyDevice.health, 'degraded');
    assert.equal(unhealthyDevice.attention, true);
    const unhealthyDashboard = await admin('/api/dashboard');
    assert.equal(unhealthyDashboard.body.counts.onlineDevices, 1);
    assert.equal(unhealthyDashboard.body.counts.healthyDevices, 0);
    db.prepare("UPDATE devices SET player_state = 'playing', cache_ready = 1 WHERE id = ?").run(created.deviceId);

    const dashboard = await admin('/api/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.counts.onlineDevices, 1);
    assert.equal(dashboard.body.counts.healthyDevices, 1);
    const dashboardDevice = dashboard.body.devices[0];
    assert.equal(dashboardDevice.broadcast.source, 'published');
    assert.equal(dashboardDevice.broadcast.playlistName, '검증 재생목록');
    assert.equal(dashboardDevice.broadcast.currentContentId, null);
    assert.deepEqual(
      dashboardDevice.broadcast.items.map((item: any) => ({
        position: item.position,
        name: item.content.name,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode,
      })),
      [
        { position: 1, name: 'poster', durationSeconds: 5, fitMode: 'contain' },
        { position: 2, name: 'sample', durationSeconds: 10, fitMode: 'cover' },
        { position: 3, name: '안내 페이지', durationSeconds: 8, fitMode: 'contain' },
      ],
    );
    assert.equal(dashboardDevice.broadcast.sampleOnly, false);
    assert.equal(dashboard.body.sampleContent.showBanner, false);
    assert.equal(dashboard.body.playerControl.desired, 'stopped');
    assert.equal(dashboard.body.playerControl.running, false);

    // The local playback-control state is independent of remote player
    // heartbeat recovery telemetry; restore the known playing state for this test.
    await player('/api/player/heartbeat', { method: 'POST', body: { state: 'playing', currentContentId: created.imageId } });

    const controlStatePath = path.join(config.dataDir, 'control', 'player-state.json');
    const writeControlState = (deviceId: string, running: boolean) => fs.writeFileSync(controlStatePath, JSON.stringify({
      schemaVersion: 1,
      desired: running ? 'running' : 'stopped',
      running,
      pid: running ? 999999 : null,
      startedAt: running ? new Date().toISOString() : null,
      deviceId,
      playerUrl: 'http://127.0.0.1:3000/player/?code=GUGAK1',
      lastError: null,
      updatedAt: new Date().toISOString(),
    }), 'utf8');
    writeControlState(created.deviceId, true);
    const runningDashboard = await admin('/api/dashboard');
    assert.equal(runningDashboard.body.devices[0].broadcast.currentContentId, created.imageId);
    assert.equal(runningDashboard.body.playerControl.running, true);
    writeControlState('another-device', true);
    const otherDeviceDashboard = await admin('/api/dashboard');
    assert.equal(otherDeviceDashboard.body.devices[0].broadcast.currentContentId, null);
    writeControlState(created.deviceId, false);
  });

  await t.test('등록 코드로 기존 연결을 인수하고 이전 토큰을 무효화한다', async () => {
    const oldToken = created.playerToken;
    const localDisplay = db.prepare('SELECT id FROM displays WHERE device_id = ? ORDER BY start_index LIMIT 1').get(created.deviceId) as { id: string } | undefined;
    assert.ok(localDisplay);
    db.prepare('UPDATE displays SET native_monitor_id = ? WHERE id = ?').run('MONITOR\\LOCAL-OLD', localDisplay.id);
    const takeover = await request('/api/player/register', {
      method: 'POST',
      body: { code: created.pairingCode, hardwareId: 'hardware-0003', takeover: true, screen: { width: 1920, height: 1080 } },
      headers: { 'X-Forwarded-For': '127.0.0.1' },
    });
    assert.equal(takeover.status, 200, JSON.stringify(takeover.body));
    assert.notEqual(takeover.body.token, oldToken);
    assert.equal(db.prepare('SELECT last_host_local FROM devices WHERE id = ?').get(created.deviceId)?.last_host_local, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM displays WHERE device_id = ? AND native_monitor_id IS NOT NULL').get(created.deviceId)?.n, 0);
    const remoteMonitorList = await admin(`/api/native-monitors?deviceId=${created.deviceId}`);
    assert.deepEqual(remoteMonitorList.body.monitors, []);
    assert.match(remoteMonitorList.body.error, /Player PC.*모니터 정보/);

    const stale = await request('/api/player/manifest', {
      headers: { Authorization: `Bearer ${oldToken}` },
    });
    assert.equal(stale.status, 401);

    created.playerToken = takeover.body.token;
    const fresh = await request('/api/player/manifest', {
      headers: { Authorization: `Bearer ${created.playerToken}`, 'X-Forwarded-For': '127.0.0.1' },
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.manifest.version, 2);
    const launch = await admin('/api/player/launch', { method: 'POST', body: { deviceId: created.deviceId } });
    assert.equal(launch.status, 202);
    assert.equal(launch.body.screenTargetCount, 0);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });
  });

  await t.test('사용 중 콘텐츠 삭제와 잘못된 연결 해제를 막는다', async () => {
    const removeContent = await admin(`/api/contents/${created.imageId}`, { method: 'DELETE' });
    assert.equal(removeContent.status, 409);
    assert.match(removeContent.body.error, /사용 중/);

    const removePlaylist = await admin(`/api/playlists/${created.playlistId}`, { method: 'DELETE' });
    assert.equal(removePlaylist.status, 409);

    const unpair = await admin(`/api/devices/${created.deviceId}/unpair`, { method: 'POST' });
    assert.equal(unpair.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM displays WHERE device_id = ? AND native_monitor_id IS NOT NULL').get(created.deviceId)?.n, 0);
    const staleManifest = await player('/api/player/manifest');
    assert.equal(staleManifest.status, 401);

    db.prepare('UPDATE displays SET native_monitor_id = ? WHERE device_id = ?').run('MONITOR\\STALE-CODE', created.deviceId);
    const regenerate = await admin(`/api/devices/${created.deviceId}/regenerate-code`, { method: 'POST' });
    assert.equal(regenerate.status, 200);
    assert.notEqual(regenerate.body.device.pairingCode, created.pairingCode);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM displays WHERE device_id = ? AND native_monitor_id IS NOT NULL').get(created.deviceId)?.n, 0);
  });

  await t.test('현재 게시 스냅샷이 참조하는 미디어 삭제를 막는다', async () => {
    const update = await admin(`/api/playlists/${created.playlistId}`, {
      method: 'PUT',
      body: {
        name: '검증 재생목록',
        description: '이미지를 빼고 다시 게시하기 전 상태',
        items: [
          { contentId: created.videoId, durationSeconds: 10, fitMode: 'cover', transitionMs: 300, enabled: true },
          { contentId: created.urlId, durationSeconds: 8, fitMode: 'contain', transitionMs: 0, enabled: true },
        ],
      },
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));

    const blocked = await admin(`/api/contents/${created.imageId}`, { method: 'DELETE' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /게시 버전/);

    const publish = await admin(`/api/devices/${created.deviceId}/publish`, { method: 'POST' });
    assert.equal(publish.status, 200);
    assert.equal(publish.body.version, 3);

    const removed = await admin(`/api/contents/${created.imageId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  });
});
