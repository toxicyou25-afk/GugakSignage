// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { seedDatabase } from '../src/seed.js';
import { buildWallPlans, buildWallSnapshot, createSite, engineSnapshotForWall, updateDisplay } from '../src/topology.js';
import { ensureDeviceTopology } from '../src/topology-migration.js';

const require = createRequire(import.meta.url);
const engine = require('../poc/packages/engine/index.js') as {
  buildLayout(options: Record<string, unknown>): any;
  buildRenderPlan(snapshot: Record<string, unknown>, displayId: string, atMs: number): any;
  wallScreenInput(wall: Record<string, unknown>, displayId: string): Record<string, unknown>;
};
const fixtures = require('../poc/test-support/fixtures.js') as {
  makeSite(options?: Record<string, unknown>): any;
  timeAtSlot(snapshot: Record<string, unknown>, slot: number): number;
  withMode(snapshot: Record<string, unknown>, mode: string): Record<string, unknown>;
};

function createLegacyDatabase(dbPath: string, deviceNames: string[]): void {
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
  `);
  const insert = legacy.prepare(`INSERT INTO devices(
    id, name, location, orientation, width, height, pairing_code, hardware_id, player_token, playlist_id,
    published_version, published_at, last_seen, last_ip, player_state, last_error, notes,
    reported_width, reported_height, created_at, updated_at
  ) VALUES (?, ?, '로비', 'landscape', 1920, 1080, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
  deviceNames.forEach((name, index) => insert.run(crypto.randomUUID(), name, `LEGACY${index + 1}`));
  legacy.close();
}

function slotMapping(db: DB): Array<{ device: string; slotId: string; startIndex: number }> {
  return all<{ device: string; slotId: string; startIndex: number }>(
    db,
    `SELECT dev.name AS device, d.slot_id AS slotId, d.start_index AS startIndex
       FROM displays d JOIN devices dev ON dev.id = d.device_id
      ORDER BY d.start_index, d.rowid`,
  );
}

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
  const previewPlans = wall.screens.map((screen: any) =>
    engine.buildRenderPlan(engine.wallScreenInput(structuredClone(wall), screen.displayId), screen.displayId, at),
  );
  assert.deepEqual(previewPlans, publishedPlans);
  assert.deepEqual(
    engineSnapshotForWall(wall, wall.displays[0].id),
    engine.wallScreenInput(wall, wall.displays[0].id),
  );
  assert.equal(new Set(publishedPlans.map((plan) => plan.imageId)).size, 1);
  assert.equal(new Set(publishedPlans.map((plan) => plan.slotId)).size, 4);
});

test('샘플 재생목록의 이미지·영상·URL 5개가 모두 wall 입력과 RenderPlan에 남는다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-wall-url-'));
  const config = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'),
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    seedSamples: true,
    adminPassword: 'wall-url-password',
    sessionSecret: 'wall-url-test-session-secret',
  });
  const db = openDatabase(config.dbPath);
  try {
    const seeded = seedDatabase(db, config);
    assert(seeded.deviceId);
    ensureDeviceTopology(db, seeded.deviceId);
    const group = get<{ id: string }>(db, 'SELECT group_id AS id FROM displays WHERE device_id = ?', seeded.deviceId)!;
    const wall = buildWallSnapshot(db, group.id, { heartbeatOnlineMs: 45_000 });
    const input = engine.wallScreenInput(wall as any, wall.displays[0].id) as any;
    assert.equal(input.playlist.items.length, 5);
    assert.deepEqual(input.playlist.items.map((item: any) => item.kind), ['image', 'image', 'video', 'image', 'url']);
    assert(input.contents.some((content: any) => content.kind === 'url' && content.name.includes('오늘의 안내')));

    const urlAt = Date.parse(wall.group.epoch) + 40_500;
    const urlPlan = buildWallPlans(wall, urlAt).find((plan) => plan.kind === 'url');
    assert(urlPlan);
    assert.equal(urlPlan.contentUrl, '/sample/notice.html');
    assert.equal(urlPlan.placeholder, false);
    assert.equal(urlPlan.nextChangeAtMs, Date.parse(wall.group.epoch) + 50_000);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('5기기 마이그레이션은 20회 실행해도 같은 장치→슬롯을 만들고 새 기기는 기존 배정을 보존한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-topology-order-'));
  const deviceNames = ['Lobby A', 'Lobby B', 'Lobby C', 'Lobby D', 'Lobby E'];
  const mappings: string[] = [];
  try {
    for (let run = 0; run < 20; run += 1) {
      const runDir = path.join(root, String(run));
      fs.mkdirSync(runDir);
      const dbPath = path.join(runDir, 'legacy.sqlite');
      createLegacyDatabase(dbPath, deviceNames);
      const db = openDatabase(dbPath);
      try {
        mappings.push(JSON.stringify(slotMapping(db)));
        assert.equal(mappings.at(-1) && JSON.parse(mappings.at(-1)!).length, 5);
      } finally {
        db.close();
      }
    }
    assert.equal(new Set(mappings).size, 1, mappings.join('\n'));

    const dbPath = path.join(root, 'append.sqlite');
    createLegacyDatabase(dbPath, deviceNames.slice(0, 3));
    const db = openDatabase(dbPath);
    try {
      const before = slotMapping(db);
      const siteId = get<{ site_id: string }>(db, 'SELECT site_id FROM devices LIMIT 1')!.site_id;
      const newDeviceId = crypto.randomUUID();
      run(
        db,
        `INSERT INTO devices(
          id, name, location, orientation, width, height, pairing_code, hardware_id, player_token,
          playlist_id, published_version, published_at, last_seen, last_ip, player_state, last_error,
          notes, reported_width, reported_height, site_id, created_at, updated_at)
         VALUES (?, 'Lobby New', '로비', 'landscape', 1920, 1080, 'LEGACYNEW', NULL, NULL, NULL,
          0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        newDeviceId,
        siteId,
        '2026-01-02T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      );
      ensureDeviceTopology(db, newDeviceId);
      const after = slotMapping(db);
      const original = after.filter((row) => row.device !== 'Lobby New');
      assert.deepEqual(original, before);
      const added = after.find((row) => row.device === 'Lobby New');
      assert(added);
      assert.equal(before.some((row) => row.slotId === added.slotId), false);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    INSERT INTO contents VALUES ('content-old', '기존 이미지', 'image', 'image/png', 'old.png', NULL,
      1, 1920, 1080, NULL, '2026-01-01');
    INSERT INTO playlist_items VALUES ('item-old', 'playlist-old', 'content-old', 1, 10, 'contain', 300, 1);
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
  assert.equal(
    get<{ fit_mode_override: string }>(db, 'SELECT fit_mode_override FROM playlist_items WHERE id = ?', 'item-old')?.fit_mode_override,
    'contain',
  );
  assert.equal(get<{ snapshot: string }>(db, 'SELECT snapshot FROM publications WHERE id = ?', 'publication-old')?.snapshot.includes('기존 목록'), true);
  db.close();

  db = openDatabase(dbPath);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sites')?.n, 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays')?.n, 1);
  assert.equal(get<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'topology_schema_version'")?.value, '2');
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('기존 디스플레이 행을 보존하며 native_monitor_id를 반복 안전하게 추가한다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-native-monitor-migration-'));
  const dbPath = path.join(tempDir, 'topology.sqlite');
  let db = openDatabase(dbPath);
  const site = createSite(db, { name: '기존 장소', timezone: 'Asia/Seoul', notes: '기존 메모' });
  const before = get<{ id: string; name: string; group_id: string; width: number; height: number }>(
    db,
    'SELECT id, name, group_id, width, height FROM displays WHERE site_id = ?',
    site.site.id,
  )!;
  db.close();

  const legacy = new DatabaseSync(dbPath);
  const columns = legacy.prepare('PRAGMA table_info(displays)').all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'native_monitor_id')) {
    legacy.exec('DROP TRIGGER IF EXISTS trg_displays_clear_native_monitor_on_device_change;');
    legacy.exec('DROP INDEX IF EXISTS idx_displays_device_native_monitor;');
    legacy.exec('ALTER TABLE displays DROP COLUMN native_monitor_id');
  }
  legacy.close();

  db = openDatabase(dbPath);
  const migratedColumns = db.prepare('PRAGMA table_info(displays)').all() as Array<{ name: string }>;
  assert.equal(migratedColumns.some((column) => column.name === 'native_monitor_id'), true);
  assert.deepEqual(
    get(db, 'SELECT id, name, group_id, width, height FROM displays WHERE id = ?', before.id),
    before,
  );
  assert.equal(get<{ native_monitor_id: string | null }>(db, 'SELECT native_monitor_id FROM displays WHERE id = ?', before.id)?.native_monitor_id, null);
  db.close();

  db = openDatabase(dbPath);
  assert.deepEqual(
    get(db, 'SELECT id, name, group_id, width, height FROM displays WHERE id = ?', before.id),
    before,
  );
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays')?.n, 1);
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('physical monitor binding uses the configured heartbeat window', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-native-monitor-heartbeat-'));
  const db = openDatabase(path.join(tempDir, 'topology.sqlite'));
  try {
    const site = createSite(db, { name: 'Heartbeat site', timezone: 'Asia/Seoul', notes: null });
    const display = get<{ id: string }>(db, 'SELECT id FROM displays WHERE site_id = ?', site.site.id)!;
    const now = new Date().toISOString();
    run(db, `INSERT INTO devices(id, name, orientation, width, height, pairing_code, published_version,
               last_host_local, last_seen, created_at, updated_at)
             VALUES ('device-heartbeat', 'Local PC', 'landscape', 1920, 1080, 'HEART1', 0, 1, ?, ?, ?),
                    ('device-other', 'Other PC', 'landscape', 1920, 1080, 'OTHER1', 0, 0, NULL, ?, ?)`,
      new Date(Date.now() - 30_000).toISOString(), now, now, now, now);
    updateDisplay(db, display.id, 60_000, { deviceId: 'device-other' });
    assert.throws(
      () => updateDisplay(db, display.id, 20_000, {
        deviceId: 'device-heartbeat', nativeMonitorId: 'MONITOR\\HEARTBEAT',
      }),
      /원격 Player의 모니터 배정/,
    );
    assert.doesNotThrow(() => updateDisplay(db, display.id, 60_000, {
      deviceId: 'device-heartbeat', nativeMonitorId: 'MONITOR\\HEARTBEAT',
    }));
    const rebound = get<{ device_id: string; native_monitor_id: string }>(
      db, 'SELECT device_id, native_monitor_id FROM displays WHERE id = ?', display.id,
    );
    assert.equal(rebound.device_id, 'device-heartbeat');
    assert.equal(rebound.native_monitor_id, 'MONITOR\\HEARTBEAT');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
    heartbeatOnlineMs: 60_000,
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
    run(db, 'UPDATE devices SET last_ip = ?, last_host_local = 1, last_seen = ? WHERE id = ?', '192.168.1.44', new Date(Date.now() - 50_000).toISOString(), device.body.device.id);
    const secondDevice = await request('/api/devices', {
      method: 'POST',
      body: { name: '단일면 PC', orientation: 'landscape', width: 1920, height: 1080, playlistId: 'playlist-1' },
    });
    assert.equal(secondDevice.status, 201, JSON.stringify(secondDevice.body));
    run(db, 'UPDATE devices SET last_ip = ?, last_host_local = 0, last_seen = ? WHERE id = ?', '192.168.1.44', new Date().toISOString(), secondDevice.body.device.id);
    const managerLocalMonitors = await request(`/api/native-monitors?deviceId=${encodeURIComponent(device.body.device.id)}`);
    assert.equal(managerLocalMonitors.status, 200, JSON.stringify(managerLocalMonitors.body));
    const remoteMonitors = await request(`/api/native-monitors?deviceId=${encodeURIComponent(secondDevice.body.device.id)}`);
    assert.equal(remoteMonitors.status, 200, JSON.stringify(remoteMonitors.body));
    assert.equal(remoteMonitors.body.supported, true);
    assert.deepEqual(remoteMonitors.body.monitors, []);
    assert.equal(remoteMonitors.body.reported, false);
    assert.match(remoteMonitors.body.error, /Player PC.*모니터 정보/);
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

    const connectorOnlyMonitorId = await request(`/api/displays/${displays[0].id}`, {
      method: 'PUT', body: { nativeMonitorId: '\\\\.\\DISPLAY1' },
    });
    assert.equal(connectorOnlyMonitorId.status, 400);

    for (const [index, nativeMonitorId] of [[0, 'MONITOR\\PRIMARY'], [1, 'MONITOR\\LEFT'], [2, 'MONITOR\\RIGHT']] as Array<[number, string]>) {
      const assigned = await request(`/api/displays/${displays[index].id}`, {
        method: 'PUT', body: { nativeMonitorId },
      });
      assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    }

    const bindMonitor = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\DISCONNECTED-SAVED' },
    });
    assert.equal(bindMonitor.status, 200, JSON.stringify(bindMonitor.body));
    assert.equal(bindMonitor.body.nativeMonitorId, 'MONITOR\\DISCONNECTED-SAVED');
    const boundDetail = await request(`/api/sites/${site.body.site.id}`);
    assert.equal(boundDetail.body.groups[0].displays[3].nativeMonitorId, 'MONITOR\\DISCONNECTED-SAVED');
    assert.equal(boundDetail.body.groups[0].devices.find((row: any) => row.id === device.body.device.id).localHost, true);

    run(db, 'UPDATE devices SET last_host_local = 0, last_seen = ? WHERE id = ?', new Date(Date.now() - config.heartbeatOnlineMs * 2).toISOString(), device.body.device.id);
    const offlineEdit = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { rotation: 90 },
    });
    assert.equal(offlineEdit.status, 200, JSON.stringify(offlineEdit.body));
    assert.equal(offlineEdit.body.nativeMonitorId, 'MONITOR\\DISCONNECTED-SAVED');
    const offlineNewBinding = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\UNREPORTED' },
    });
    assert.equal(offlineNewBinding.status, 400);
    run(db, 'UPDATE devices SET last_host_local = 1, last_seen = ? WHERE id = ?', new Date().toISOString(), device.body.device.id);

    const launchWithMonitorTargets = await request('/api/player/launch', {
      method: 'POST', body: { deviceId: device.body.device.id },
    });
    assert.equal(launchWithMonitorTargets.status, 202, JSON.stringify(launchWithMonitorTargets.body));
    assert.equal(launchWithMonitorTargets.body.screenTargetCount, 0);
    const launchCommand = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'control', 'player-command.json'), 'utf8'));
    assert.deepEqual(launchCommand.screenTargets, []);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });

    run(db, 'UPDATE devices SET last_host_local = 1, last_seen = ? WHERE id = ?',
      new Date(Date.now() - config.heartbeatOnlineMs * 2).toISOString(), device.body.device.id);
    const staleLocalLaunch = await request('/api/player/launch', {
      method: 'POST', body: { deviceId: device.body.device.id },
    });
    assert.equal(staleLocalLaunch.status, 202, JSON.stringify(staleLocalLaunch.body));
    assert.equal(staleLocalLaunch.body.screenTargetCount, 0);
    const staleLaunchCommand = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'control', 'player-command.json'), 'utf8'));
    assert.deepEqual(staleLaunchCommand.screenTargets, []);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });
    run(db, 'UPDATE devices SET last_seen = ? WHERE id = ?', new Date().toISOString(), device.body.device.id);

    const hostMonitors = await request('/api/native-monitors');
    assert.equal(hostMonitors.status, 200, JSON.stringify(hostMonitors.body));
    assert.equal(hostMonitors.body.monitors.some((monitor: any) => monitor.bindingId === 'MONITOR\\DISCONNECTED-SAVED'), false);
    const disconnectedDetail = await request(`/api/sites/${site.body.site.id}`);
    assert.equal(disconnectedDetail.body.groups[0].displays[3].nativeMonitorId, 'MONITOR\\DISCONNECTED-SAVED');

    const duplicateMonitor = await request(`/api/displays/${displays[2].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\DISCONNECTED-SAVED' },
    });
    assert.equal(duplicateMonitor.status, 400);
    const monitorWithoutDevice = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { deviceId: null, nativeMonitorId: 'MONITOR\\DISCONNECTED-SAVED' },
    });
    assert.equal(monitorWithoutDevice.status, 400);
    const unpairAndClearSavedMonitor = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { deviceId: null },
    });
    assert.equal(unpairAndClearSavedMonitor.status, 200, JSON.stringify(unpairAndClearSavedMonitor.body));
    assert.equal(unpairAndClearSavedMonitor.body.nativeMonitorId, null);

    const unreportedRemoteBinding = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { deviceId: secondDevice.body.device.id, nativeMonitorId: 'MONITOR\\REMOTE-UNREPORTED' },
    });
    assert.equal(unreportedRemoteBinding.status, 400);
    const remoteReassignment = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { deviceId: secondDevice.body.device.id, nativeMonitorId: null },
    });
    assert.equal(remoteReassignment.status, 200, JSON.stringify(remoteReassignment.body));
    assert.equal(remoteReassignment.body.nativeMonitorId, null);
    const remoteLaunch = await request('/api/player/launch', {
      method: 'POST', body: { deviceId: secondDevice.body.device.id },
    });
    assert.equal(remoteLaunch.status, 202, JSON.stringify(remoteLaunch.body));
    assert.equal(remoteLaunch.body.screenTargetCount, 0);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });

    run(db, 'UPDATE devices SET last_host_local = 1, last_seen = ? WHERE id = ?', new Date().toISOString(), secondDevice.body.device.id);
    const reassigned = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\SECOND' },
    });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
    assert.equal(reassigned.body.nativeMonitorId, 'MONITOR\\SECOND');
    const reassignedDetail = await request(`/api/sites/${site.body.site.id}`);
    assert.equal(reassignedDetail.body.groups[0].displays[3].nativeMonitorId, 'MONITOR\\SECOND');
    const localLaunchAfterBinding = await request('/api/player/launch', {
      method: 'POST', body: { deviceId: secondDevice.body.device.id },
    });
    assert.equal(localLaunchAfterBinding.status, 202, JSON.stringify(localLaunchAfterBinding.body));
    assert.equal(localLaunchAfterBinding.body.screenTargetCount, 0);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });

    const sameIdOnOtherDevice = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\PRIMARY' },
    });
    assert.equal(sameIdOnOtherDevice.status, 200, JSON.stringify(sameIdOnOtherDevice.body));
    const sameIdOnFirstDevice = await request(`/api/displays/${displays[2].id}`, {
      method: 'PUT', body: { nativeMonitorId: 'MONITOR\\DISCONNECTED-SAVED' },
    });
    assert.equal(sameIdOnFirstDevice.status, 200, JSON.stringify(sameIdOnFirstDevice.body));
    const clearMonitor = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT', body: { nativeMonitorId: null },
    });
    assert.equal(clearMonitor.status, 200, JSON.stringify(clearMonitor.body));
    assert.equal(clearMonitor.body.nativeMonitorId, null);

    const displayUpdate = await request(`/api/displays/${displays[3].id}`, {
      method: 'PUT',
      body: { playlistId: 'playlist-2', rotation: 0, fitMode: 'cover', deviceId: secondDevice.body.device.id },
    });
    assert.equal(displayUpdate.status, 200, JSON.stringify(displayUpdate.body));
    assert.equal(displayUpdate.body.preview.plans.length, 4);
    assert.equal(displayUpdate.body.preview.plans[3].imageId, 'image-2');
    assert.equal(displayUpdate.body.preview.plans[0].imageId, 'image-1');
    assert.equal(displayUpdate.body.preview.plans[3].fit, 'cover');

    const unspecifiedItemFit = await request('/api/playlists/playlist-2', {
      method: 'PUT',
      body: {
        name: '오른쪽 전용',
        description: null,
        items: [{ contentId: 'image-2', durationSeconds: 10, transitionMs: 300, enabled: true }],
      },
    });
    assert.equal(unspecifiedItemFit.status, 200, JSON.stringify(unspecifiedItemFit.body));
    assert.equal(unspecifiedItemFit.body.items[0].fitMode, null);
    const itemFallbackPreview = await request(`/api/groups/${groupId}/preview`);
    const itemFallbackPlan = itemFallbackPreview.body.plans.find((plan: any) => plan.displayId === displays[3].id);
    assert.equal(itemFallbackPlan.fit, 'cover');

    const explicitItemFit = await request('/api/playlists/playlist-2', {
      method: 'PUT',
      body: {
        name: '오른쪽 전용',
        description: null,
        items: [{ contentId: 'image-2', durationSeconds: 10, fitMode: 'contain', transitionMs: 300, enabled: true }],
      },
    });
    assert.equal(explicitItemFit.status, 200, JSON.stringify(explicitItemFit.body));
    const explicitPreview = await request(`/api/groups/${groupId}/preview`);
    const explicitPlan = explicitPreview.body.plans.find((plan: any) => plan.displayId === displays[3].id);
    assert.equal(explicitPlan.fit, 'contain');

    await request('/api/playlists/playlist-2', {
      method: 'PUT',
      body: {
        name: '오른쪽 전용',
        description: null,
        items: [{ contentId: 'image-2', durationSeconds: 10, transitionMs: 300, enabled: true }],
      },
    });

    const published = await request(`/api/groups/${groupId}/publish`, { method: 'POST' });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.version, 1);
    assert.equal(published.body.deviceIds.length, 2);
    const launchAfterPublish = await request('/api/player/launch', {
      method: 'POST', body: { deviceId: device.body.device.id },
    });
    assert.equal(launchAfterPublish.status, 202, JSON.stringify(launchAfterPublish.body));
    assert.equal(launchAfterPublish.body.screenTargetCount, 3);
    const publishedLaunchCommand = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'control', 'player-command.json'), 'utf8'));
    assert.deepEqual(publishedLaunchCommand.screenTargets.map((target: any) => target.displayId), displays.slice(0, 3).map((display: any) => display.id));
    assert.deepEqual(publishedLaunchCommand.screenTargets.map((target: any) => target.nativeMonitorId), [
      'MONITOR\\PRIMARY', 'MONITOR\\LEFT', 'MONITOR\\DISCONNECTED-SAVED',
    ]);
    fs.rmSync(path.join(config.dataDir, 'control', 'player-command.json'), { force: true });
    const frozen = get<{ snapshot: string }>(db, 'SELECT snapshot FROM publications WHERE device_id = ? AND version = 1', device.body.device.id)!.snapshot;
    assert(frozen.includes('"schemaVersion":2'));
    assert(frozen.includes('"playlistId":"playlist-2"'));
    assert.equal(frozen.includes('nativeMonitorId'), true);
    assert.equal(frozen.includes('native_monitor_id'), false);
    const frozenWall = JSON.parse(frozen).wall;
    const frozenDisplay = frozenWall.displays.find((display: any) => display.id === displays[3].id);
    const frozenPrimaryDisplay = frozenWall.displays.find((display: any) => display.id === displays[0].id);
    const frozenScreen = frozenWall.screens.find((screen: any) => screen.displayId === displays[3].id);
    assert.equal(frozenDisplay.nativeMonitorId, null);
    assert.equal(frozenPrimaryDisplay.nativeMonitorId, 'MONITOR\\PRIMARY');
    assert.equal(frozenDisplay.fit, 'cover');
    assert.equal(Object.hasOwn(frozenScreen.playlist.items[0], 'fitMode'), false);
    assert.equal(get<{ hardware_id: string | null }>(db, 'SELECT hardware_id FROM devices WHERE id = ?', device.body.device.id)?.hardware_id, null);

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
    run(db, 'UPDATE devices SET last_host_local = 0 WHERE id = ?', secondDevice.body.device.id);
    const reportedMonitors = [{ stableId: 'REMOTE-PRIMARY', bindingId: 'MONITOR\\REMOTE-PRIMARY', deviceName: '\\\\.\\DISPLAY1', friendlyName: 'Remote primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 }, orientation: 'landscape', primary: true, attached: true }];
    const unauthenticatedReport = await request('/api/player/native-monitors', { method: 'PUT', body: { monitors: reportedMonitors } });
    assert.equal(unauthenticatedReport.status, 401);
    const reported = await request('/api/player/native-monitors', { method: 'PUT', token: secondRegistration.body.token, body: { monitors: reportedMonitors } });
    assert.equal(reported.status, 200, JSON.stringify(reported.body));
    const managerRemoteMonitors = await request(`/api/native-monitors?deviceId=${encodeURIComponent(secondDevice.body.device.id)}`);
    assert.equal(managerRemoteMonitors.status, 200, JSON.stringify(managerRemoteMonitors.body));
    assert.deepEqual(managerRemoteMonitors.body.monitors.map((monitor: any) => monitor.bindingId), ['MONITOR\\REMOTE-PRIMARY']);
    assert.ok(managerRemoteMonitors.body.detectedAt);
    const unboundRemoteMonitor = {
      ...reportedMonitors[0], stableId: 'REMOTE-UNBOUND', bindingId: null,
      deviceName: '\\\\.\\DISPLAY2', friendlyName: 'Remote monitor without a stable binding', primary: false,
    };
    const reportWithUnboundMonitor = await request('/api/player/native-monitors', {
      method: 'PUT', token: secondRegistration.body.token, body: { monitors: [...reportedMonitors, unboundRemoteMonitor] },
    });
    assert.equal(reportWithUnboundMonitor.status, 200, JSON.stringify(reportWithUnboundMonitor.body));
    const reportedBoundAndUnbound = await request(`/api/native-monitors?deviceId=${encodeURIComponent(secondDevice.body.device.id)}`);
    assert.deepEqual(reportedBoundAndUnbound.body.monitors.map((monitor: any) => monitor.bindingId), ['MONITOR\\REMOTE-PRIMARY', null]);
    const invalidReport = await request('/api/player/native-monitors', { method: 'PUT', token: secondRegistration.body.token, body: { monitors: [{ ...reportedMonitors[0], bounds: { ...reportedMonitors[0].bounds, width: -1 } }] } });
    assert.equal(invalidReport.status, 400);
    const oversizedReport = await request('/api/player/native-monitors', { method: 'PUT', token: secondRegistration.body.token, body: { monitors: Array(33).fill(reportedMonitors[0]).map((monitor: any, index: number) => ({ ...monitor, stableId: `REMOTE-${index}`, bindingId: `MONITOR\\REMOTE-${index}` })) } });
    assert.equal(oversizedReport.status, 400);
    const preservedReport = await request(`/api/native-monitors?deviceId=${encodeURIComponent(secondDevice.body.device.id)}`);
    assert.deepEqual(preservedReport.body.monitors.map((monitor: any) => monitor.bindingId), ['MONITOR\\REMOTE-PRIMARY', null]);
    const manifest = await request('/api/player/manifest', { token: registration.body.token });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.manifest.wall.displays.length, 4);
    assert.equal(manifest.body.manifest.wall.layout.type, 'grid');
    assert.equal(manifest.body.manifest.wall.screens.length, 3);
    assert.equal(manifest.body.manifest.wall.screens.some((screen: any) => screen.playlistId === 'playlist-2'), false);
    const secondManifest = await request('/api/player/manifest', { token: secondRegistration.body.token });
    assert.equal(secondManifest.body.manifest.wall.screens.length, 1);
    assert.equal(secondManifest.body.manifest.wall.screens[0].playlistId, 'playlist-2');
    const unauthenticatedTargets = await request('/api/player/screen-targets');
    assert.equal(unauthenticatedTargets.status, 401);

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

    const explicitSecondPc = await request(`/api/displays/${displays[1].id}`, {
      method: 'PUT',
      body: { deviceId: secondDevice.body.device.id, nativeMonitorId: 'MONITOR\\REMOTE-PRIMARY' },
    });
    assert.equal(explicitSecondPc.status, 200, JSON.stringify(explicitSecondPc.body));
    const draftRemoteTargets = await request('/api/player/screen-targets', { token: secondRegistration.body.token });
    assert.equal(draftRemoteTargets.status, 200, JSON.stringify(draftRemoteTargets.body));
    assert.deepEqual(draftRemoteTargets.body.screenTargets, []);
    const remoteTargetsPublished = await request(`/api/groups/${groupId}/publish`, { method: 'POST' });
    assert.equal(remoteTargetsPublished.status, 200, JSON.stringify(remoteTargetsPublished.body));
    const remoteTargets = await request('/api/player/screen-targets', { token: secondRegistration.body.token });
    assert.equal(remoteTargets.status, 200, JSON.stringify(remoteTargets.body));
    assert.deepEqual(remoteTargets.body.screenTargets, [{ displayId: displays[1].id, nativeMonitorId: 'MONITOR\\REMOTE-PRIMARY' }]);
    run(db, 'UPDATE displays SET device_id = ?, native_monitor_id = NULL WHERE id = ?', secondDevice.body.device.id, displays[0].id);
    const partialRemoteTargets = await request('/api/player/screen-targets', { token: secondRegistration.body.token });
    assert.deepEqual(partialRemoteTargets.body.screenTargets, remoteTargets.body.screenTargets);
    run(db, 'UPDATE displays SET enabled = 0 WHERE id = ?', displays[0].id);
    const disabledRemoteTargets = await request('/api/player/screen-targets', { token: secondRegistration.body.token });
    assert.deepEqual(disabledRemoteTargets.body.screenTargets, remoteTargets.body.screenTargets);
    run(db, 'UPDATE displays SET device_id = ?, enabled = 1 WHERE id = ?', device.body.device.id, displays[0].id);
    run(db, 'UPDATE displays SET enabled = 1 WHERE id = ?', displays[1].id);
    const mappingBeforeGroupSave = all<{ id: string; device_id: string | null }>(
      db,
      'SELECT id, device_id FROM displays WHERE group_id = ? ORDER BY start_index, rowid',
      groupId,
    );
    assert.deepEqual(
      mappingBeforeGroupSave.map((display) => display.device_id),
      [device.body.device.id, secondDevice.body.device.id],
    );
    const availableDetail = await request(`/api/sites/${site.body.site.id}`);
    assert.deepEqual(
      availableDetail.body.groups[0].devices.map((entry: any) => entry.id).sort(),
      [device.body.device.id, secondDevice.body.device.id].sort(),
    );

    const resolutionOnlySave = await request(`/api/groups/${groupId}/configuration`, {
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
    assert.equal(resolutionOnlySave.status, 200, JSON.stringify(resolutionOnlySave.body));
    assert.deepEqual(
      all<{ id: string; device_id: string | null }>(
        db,
        'SELECT id, device_id FROM displays WHERE group_id = ? ORDER BY start_index, rowid',
        groupId,
      ).map((display) => display.device_id),
      mappingBeforeGroupSave.map((display) => display.device_id),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
