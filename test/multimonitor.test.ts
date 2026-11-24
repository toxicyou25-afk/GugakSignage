// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { all, get, openDatabase, run, type DB } from '../src/db.js';
import { buildWallPlans } from '../src/topology.js';

const require = createRequire(import.meta.url);
const engine = require('../poc/packages/engine/index.js') as {
  buildLayout(options: Record<string, unknown>): any;
  buildRenderPlan(snapshot: Record<string, unknown>, displayId: string, atMs: number): any;
};
const fixtures = require('../poc/test-support/fixtures.js') as {
  makeSite(options?: Record<string, unknown>): any;
  timeAtSlot(snapshot: Record<string, unknown>, slot: number): number;
  withMode(snapshot: Record<string, unknown>, mode: string): Record<string, unknown>;
};

test('다중 모니터 RenderPlan은 1·2·4·8대, 이미지 0·1·3·10장, 방향·회전·배치·모드를 모두 처리한다', () => {
  const modes = ['individual', 'synchronized-cycle', 'mirror', 'canvas'];
  const layouts = ['single', 'row', 'column', 'grid'] as const;
  for (const displayCount of [1, 2, 4, 8]) {
    for (const imageCount of [0, 1, 3, 10]) {
      for (const mode of modes) {
        const layoutType = displayCount === 1 ? layouts[(imageCount + modes.indexOf(mode)) % layouts.length] : layouts[1 + ((imageCount + modes.indexOf(mode)) % 3)];
        const base = fixtures.makeSite({
          imageCount,
          displayCount,
          mode,
          layoutType,
          displayOptions: {
            portraitIndexes: displayCount > 1 ? [displayCount - 1] : [],
            rotations: Array.from({ length: displayCount }, (_, index) => (index === displayCount - 1 ? 90 : 0)),
          },
        });
        const snapshot = fixtures.withMode(base.snapshot, mode);
        const at = fixtures.timeAtSlot(snapshot, 0);
        const plans = snapshot.displays.map((display: { id: string }) => engine.buildRenderPlan(snapshot, display.id, at));
        assert.equal(plans.length, displayCount);
        assert(plans.every((plan: any) => Number.isFinite(plan.destinationRect.x) && plan.destinationRect.w >= 0));
        assert(plans.every((plan: any) => [0, 90, 180, 270].includes(plan.rotation)));
        assert.equal(plans.at(-1).rotation, 90);
        if (imageCount === 0) assert(plans.every((plan: any) => plan.placeholder && plan.sourceRect === null));
        else assert(plans.every((plan: any) => plan.imageId && plan.sourceRect));
        if (mode !== 'individual' && imageCount > 0) {
          assert.equal(new Set(plans.map((plan: any) => plan.nextChangeAtMs)).size, 1);
        }
      }
    }
  }
});

test('게시 스냅샷과 미리보기는 같은 wall 입력에서 같은 RenderPlan을 만든다', () => {
  const base = fixtures.makeSite({ imageCount: 3, displayCount: 4, mode: 'canvas', layoutType: 'grid' });
  const manifestPlaylist = {
    id: base.playlist.id,
    name: base.playlist.name,
    description: null,
    items: base.playlist.items.map((item: any, index: number) => ({
      id: item.id,
      position: index + 1,
      durationSeconds: item.durationMs / 1000,
      fitMode: item.fitMode,
      transitionMs: item.transitionMs,
      enabled: item.enabled,
      content: {
        id: item.imageId,
        name: base.images[index].filename,
        kind: 'image',
        mime: base.images[index].mime,
        url: base.images[index].displayUrl,
        width: base.images[index].width,
        height: base.images[index].height,
      },
    })),
  };
  const wall = {
    schemaVersion: 2,
    publishedAt: null,
    site: { id: 'site-1', name: 'Site', timezone: 'Asia/Seoul', notes: null },
    group: {
      id: 'group-1',
      siteId: 'site-1',
      name: 'Wall',
      layoutId: 'layout-1',
      playlistId: 'playlist-1',
      playbackMode: 'canvas',
      epoch: base.group.epoch,
      settings: { dwellMs: 10_000, transitionMs: 300 },
    },
    layout: base.layout,
    displays: base.displays.map((display: any) => ({
      ...display,
      fit: 'contain',
      deviceId: 'pc-1',
    })),
    screens: base.displays.map((display: any) => ({
      displayId: display.id,
      playlistId: 'playlist-1',
      playlist: manifestPlaylist,
    })),
    groupPlaylist: manifestPlaylist,
    dwellMs: 10_000,
  };
  const at = fixtures.timeAtSlot(base.snapshot, 1);
  const publishedPlans = buildWallPlans(wall, at);
  const previewPlans = buildWallPlans(structuredClone(wall), at);
  assert.deepEqual(previewPlans, publishedPlans);
  assert.equal(new Set(publishedPlans.map((plan) => plan.imageId)).size, 1);
  assert.equal(new Set(publishedPlans.map((plan) => plan.slotId)).size, 4);
});

test('기존 SQLite MVP 기기는 기본 장소와 1모니터로 멱등 마이그레이션된다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-topology-migrate-'));
  const dbPath = path.join(tempDir, 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE contents (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT,
      stored_name TEXT, external_url TEXT, file_size INTEGER, width INTEGER, height INTEGER,
      checksum TEXT, created_at TEXT NOT NULL);
    CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE playlist_items (id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL, content_id TEXT NOT NULL,
      position INTEGER NOT NULL, duration_seconds INTEGER NOT NULL, fit_mode TEXT NOT NULL,
      transition_ms INTEGER NOT NULL, enabled INTEGER NOT NULL);
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT,
      orientation TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, pairing_code TEXT NOT NULL,
      hardware_id TEXT, player_token TEXT, playlist_id TEXT, published_version INTEGER NOT NULL,
      published_at TEXT, last_seen TEXT, last_ip TEXT, player_state TEXT, last_error TEXT, notes TEXT,
      reported_width INTEGER, reported_height INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, playlist_id TEXT NOT NULL,
      days TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL);
    CREATE TABLE publications (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, version INTEGER NOT NULL,
      snapshot TEXT NOT NULL, published_at TEXT NOT NULL, UNIQUE(device_id, version));
    INSERT INTO playlists VALUES ('playlist-old', '기존 목록', NULL, '2026-01-01', '2026-01-01');
    INSERT INTO devices VALUES ('device-old', '기존 로비 PC', '로비', 'landscape', 1920, 1080, 'OLD001',
      NULL, NULL, 'playlist-old', 7, '2026-01-02', NULL, NULL, 'playing', NULL, NULL, NULL, NULL,
      '2026-01-01', '2026-01-02');
    INSERT INTO publications VALUES ('publication-old', 'device-old', 7,
      '{"defaultPlaylist":{"id":"playlist-old","name":"기존 목록","description":null,"items":[]},"schedules":[]}',
      '2026-01-02');
  `);
  legacy.close();

  let db = openDatabase(dbPath);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sites')?.n, 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays')?.n, 1);
  assert.equal(get<{ site_id: string }>(db, 'SELECT site_id FROM devices WHERE id = ?', 'device-old')?.site_id?.length, 36);
  assert.equal(get<{ playlist_id: string }>(db, 'SELECT playlist_id FROM displays WHERE device_id = ?', 'device-old')?.playlist_id, 'playlist-old');
  assert.equal(get<{ snapshot: string }>(db, 'SELECT snapshot FROM publications WHERE id = ?', 'publication-old')?.snapshot.includes('기존 목록'), true);
  db.close();

  db = openDatabase(dbPath);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sites')?.n, 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays')?.n, 1);
  assert.equal(get<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'topology_schema_version'")?.value, '2');
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('장소·4모니터·화면별 배정·미리보기·불변 게시 흐름', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-topology-api-'));
  const config: AppConfig = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'),
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: false,
    adminPassword: 'topology-password',
    sessionSecret: 'topology-test-session-secret',
  });
  const db = openDatabase(config.dbPath);
  const now = new Date().toISOString();
  run(db, `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
           VALUES ('image-1', '가로 포스터', 'image', 'image/png', 'one.png', NULL, 1, 1920, 1080, NULL, ?)`, now);
  run(db, `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
           VALUES ('image-2', '세로 포스터', 'image', 'image/png', 'two.png', NULL, 1, 1080, 1920, NULL, ?)`, now);
  run(db, `INSERT INTO playlists(id, name, description, created_at, updated_at)
           VALUES ('playlist-1', '그룹 순환', NULL, ?, ?)`, now, now);
  run(db, `INSERT INTO playlists(id, name, description, created_at, updated_at)
           VALUES ('playlist-2', '오른쪽 전용', NULL, ?, ?)`, now, now);
  run(db, `INSERT INTO playlist_items(id, playlist_id, content_id, position, duration_seconds, fit_mode, transition_ms, enabled)
           VALUES ('item-1', 'playlist-1', 'image-1', 1, 10, 'contain', 300, 1)`);
  run(db, `INSERT INTO playlist_items(id, playlist_id, content_id, position, duration_seconds, fit_mode, transition_ms, enabled)
           VALUES ('item-2', 'playlist-2', 'image-2', 1, 10, 'contain', 300, 1)`);
  const app = createApp(db, config);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = '';
  const request = async (route: string, options: { method?: string; body?: unknown; token?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${route}`, { method: options.method || 'GET', headers, body });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  try {
    const login = await request('/api/auth/login', { method: 'POST', body: { password: 'topology-password' } });
    cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const device = await request('/api/devices', {
      method: 'POST',
      body: { name: '4면 PC', orientation: 'landscape', width: 1920, height: 1080, playlistId: 'playlist-1' },
    });
    assert.equal(device.status, 201, JSON.stringify(device.body));
    const secondDevice = await request('/api/devices', {
      method: 'POST',
      body: { name: '단일면 PC', orientation: 'landscape', width: 1920, height: 1080, playlistId: 'playlist-1' },
    });
    assert.equal(secondDevice.status, 201, JSON.stringify(secondDevice.body));
    const site = await request('/api/sites', { method: 'POST', body: { name: '1층 로비', timezone: 'Asia/Seoul' } });
    assert.equal(site.status, 201, JSON.stringify(site.body));
    const detail = await request(`/api/sites/${site.body.site.id}`);
    const groupId = detail.body.groups[0].id;
    const configured = await request(`/api/groups/${groupId}/configuration`, {
      method: 'PUT',
      body: {
        displayCount: 4,
        width: 1920,
        height: 1080,
        orientation: 'landscape',
        rotation: 0,
        layoutType: 'grid',
        columns: 2,
        rows: 2,
        gap: 0.01,
        deviceId: device.body.device.id,
        playlistId: 'playlist-1',
        playbackMode: 'synchronized-cycle',
        dwellMs: 10_000,
        fitMode: 'contain',
        resetEpoch: true,
      },
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    const displays = configured.body.preview.wall.displays;
    assert.equal(displays.length, 4);
    const displayUpdate = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT',
      body: { playlistId: 'playlist-2', rotation: 0, fitMode: 'cover', deviceId: secondDevice.body.device.id },
    });
    assert.equal(displayUpdate.status, 200, JSON.stringify(displayUpdate.body));
    assert.equal(displayUpdate.body.preview.plans.length, 4);
    assert.equal(displayUpdate.body.preview.plans[3].imageId, 'image-2');
    assert.equal(displayUpdate.body.preview.plans[0].imageId, 'image-1');

    const published = await request(`/api/groups/${groupId}/publish`, { method: 'POST' });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.version, 1);
    assert.equal(published.body.deviceIds.length, 2);
    const frozen = get<{ snapshot: string }>(db, 'SELECT snapshot FROM publications WHERE device_id = ? AND version = 1', device.body.device.id)!.snapshot;
    assert(frozen.includes('"schemaVersion":2'));
    assert(frozen.includes('"playlistId":"playlist-2"'));

    const registration = await request('/api/player/register', {
      method: 'POST',
      body: { code: device.body.device.pairingCode, hardwareId: 'hardware-four-monitors' },
    });
    assert.equal(registration.status, 200, JSON.stringify(registration.body));
    const secondRegistration = await request('/api/player/register', {
      method: 'POST',
      body: { code: secondDevice.body.device.pairingCode, hardwareId: 'hardware-second-pc' },
    });
    assert.equal(secondRegistration.status, 200, JSON.stringify(secondRegistration.body));
    const manifest = await request('/api/player/manifest', { token: registration.body.token });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.manifest.wall.displays.length, 4);
    assert.equal(manifest.body.manifest.wall.layout.type, 'grid');
    assert.equal(manifest.body.manifest.wall.screens.length, 3);
    assert.equal(manifest.body.manifest.wall.screens.some((screen: any) => screen.playlistId === 'playlist-2'), false);
    const secondManifest = await request('/api/player/manifest', { token: secondRegistration.body.token });
    assert.equal(secondManifest.body.manifest.wall.screens.length, 1);
    assert.equal(secondManifest.body.manifest.wall.screens[0].playlistId, 'playlist-2');

    const changed = await request(`/api/groups/${groupId}/configuration`, {
      method: 'PUT',
      body: {
        displayCount: 2,
        width: 1080,
        height: 1920,
        orientation: 'portrait',
        rotation: 270,
        layoutType: 'column',
        gap: 0.01,
        deviceId: device.body.device.id,
        playlistId: 'playlist-1',
        playbackMode: 'individual',
        dwellMs: 7_000,
        fitMode: 'contain',
        resetEpoch: false,
      },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const stillFrozen = get<{ snapshot: string }>(db, 'SELECT snapshot FROM publications WHERE device_id = ? AND version = 1', device.body.device.id)!.snapshot;
    assert.equal(stillFrozen, frozen);
    const unchangedManifest = await request('/api/player/manifest', { token: registration.body.token });
    assert.equal(unchangedManifest.body.manifest.version, 1);
    assert.equal(unchangedManifest.body.manifest.wall.displays.length, 4);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
