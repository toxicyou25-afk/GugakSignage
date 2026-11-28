/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateLegacyTopology } from './topology-migration.js';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { hashPlayerToken } from './util.js';

export type DB = DatabaseSync;

export function openDatabase(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  migrateLegacyTopology(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'url')),
      mime TEXT,
      stored_name TEXT,
      external_url TEXT,
      file_size INTEGER,
      width INTEGER,
      height INTEGER,
      checksum TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 10,
      fit_mode TEXT NOT NULL DEFAULT 'contain' CHECK (fit_mode IN ('contain', 'cover', 'stretch')),
      fit_mode_override TEXT CHECK (fit_mode_override IN ('contain', 'cover', 'stretch')),
      transition_ms INTEGER NOT NULL DEFAULT 400,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist
      ON playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS layouts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('single', 'row', 'column', 'grid', 'custom')),
      canvas_width INTEGER NOT NULL,
      canvas_height INTEGER NOT NULL,
      gap REAL NOT NULL DEFAULT 0.01,
      bezel REAL NOT NULL DEFAULT 0,
      slots_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      orientation TEXT NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait')),
      width INTEGER NOT NULL DEFAULT 1920,
      height INTEGER NOT NULL DEFAULT 1080,
      pairing_code TEXT NOT NULL UNIQUE,
      hardware_id TEXT,
      player_token TEXT UNIQUE,
      player_token_hash TEXT,
      pairing_code_expires_at TEXT,
      pairing_code_consumed_at TEXT,
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      published_version INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      last_seen TEXT,
      last_ip TEXT,
      last_host_local INTEGER NOT NULL DEFAULT 0 CHECK (last_host_local IN (0, 1)),
      player_state TEXT,
      last_error TEXT,
      player_version TEXT,
      manifest_version INTEGER,
      last_manifest_at TEXT,
      cache_ready INTEGER,
      last_heartbeat_at TEXT,
      reconnect_count INTEGER NOT NULL DEFAULT 0,
      last_reconnect_at TEXT,
      notes TEXT,
      reported_width INTEGER,
      reported_height INTEGER,
      site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_monitor_reports (
      device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      reported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_pairing_attempts (
      client_key_hash TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS display_groups (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE RESTRICT,
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      playback_mode TEXT NOT NULL DEFAULT 'synchronized-cycle'
        CHECK (playback_mode IN ('individual', 'synchronized-cycle', 'mirror', 'canvas')),
      epoch TEXT NOT NULL,
      dwell_ms INTEGER NOT NULL DEFAULT 10000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS displays (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES display_groups(id) ON DELETE CASCADE,
      device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      orientation TEXT NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait')),
      rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
      fit_mode TEXT NOT NULL DEFAULT 'contain' CHECK (fit_mode IN ('contain', 'cover', 'stretch')),
      slot_id TEXT NOT NULL,
      start_index INTEGER NOT NULL DEFAULT 0,
      step INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      native_monitor_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_display_groups_site ON display_groups(site_id);
    CREATE INDEX IF NOT EXISTS idx_displays_group ON displays(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_displays_device ON displays(device_id);

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
      days TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_device ON schedules(device_id);

    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE(device_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_publications_device
      ON publications(device_id, version DESC);
  `);

  const tokenColumns = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>;
  if (!tokenColumns.some((column) => column.name === 'player_token_hash')) {
    db.exec('ALTER TABLE devices ADD COLUMN player_token_hash TEXT;');
  }
  if (!tokenColumns.some((column) => column.name === 'pairing_code_expires_at')) {
    db.exec('ALTER TABLE devices ADD COLUMN pairing_code_expires_at TEXT;');
  }
  if (!tokenColumns.some((column) => column.name === 'pairing_code_consumed_at')) {
    db.exec('ALTER TABLE devices ADD COLUMN pairing_code_consumed_at TEXT;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_player_token_hash ON devices(player_token_hash);');
  db.exec('BEGIN IMMEDIATE;');
  try {
    const legacyTokens = db.prepare('SELECT id, player_token FROM devices WHERE player_token IS NOT NULL').all() as Array<{ id: string; player_token: string }>;
    const update = db.prepare('UPDATE devices SET player_token_hash = ?, player_token = NULL WHERE id = ?');
    for (const row of legacyTokens) update.run(hashPlayerToken(row.player_token), row.id);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const columns = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'site_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN site_id TEXT REFERENCES sites(id) ON DELETE SET NULL;');
  }
  const healthColumns: Array<{ name: string; ddl: string }> = [
    { name: 'last_host_local', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'player_version', ddl: 'TEXT' },
    { name: 'manifest_version', ddl: 'INTEGER' },
    { name: 'last_manifest_at', ddl: 'TEXT' },
    { name: 'cache_ready', ddl: 'INTEGER' },
    { name: 'last_heartbeat_at', ddl: 'TEXT' },
    { name: 'reconnect_count', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'last_reconnect_at', ddl: 'TEXT' },
  ];
  const refreshedDeviceColumns = db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>;
  for (const healthColumn of healthColumns) {
    if (!refreshedDeviceColumns.some((column) => column.name === healthColumn.name)) {
      db.exec(`ALTER TABLE devices ADD COLUMN ${healthColumn.name} ${healthColumn.ddl};`);
    }
  }
  const playlistItemColumns = db.prepare('PRAGMA table_info(playlist_items)').all() as Array<{ name: string }>;
  if (!playlistItemColumns.some((column) => column.name === 'fit_mode_override')) {
    transaction(db, () => {
      db.exec(`ALTER TABLE playlist_items
        ADD COLUMN fit_mode_override TEXT CHECK (fit_mode_override IN ('contain', 'cover', 'stretch'));`);
      // Keep the column addition and historical value migration atomic.
      db.exec('UPDATE playlist_items SET fit_mode_override = fit_mode WHERE fit_mode_override IS NULL;');
    });
  }
  const displayColumns = db.prepare('PRAGMA table_info(displays)').all() as Array<{ name: string }>;
  if (!displayColumns.some((column) => column.name === 'native_monitor_id')) {
    db.exec('ALTER TABLE displays ADD COLUMN native_monitor_id TEXT;');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_displays_device_native_monitor
      ON displays(device_id, native_monitor_id)
      WHERE device_id IS NOT NULL AND native_monitor_id IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS trg_displays_clear_native_monitor_on_device_change
      AFTER UPDATE OF device_id ON displays
      FOR EACH ROW
      WHEN OLD.device_id IS NOT NEW.device_id AND NEW.native_monitor_id IS NOT NULL
      BEGIN
        UPDATE displays SET native_monitor_id = NULL WHERE id = NEW.id;
      END;
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);');
}

export function all<T>(db: DB, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(db: DB, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: DB, sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number | bigint } {
  return db.prepare(sql).run(...params) as { changes: number; lastInsertRowid: number | bigint };
}

export function transaction<T>(db: DB, work: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = work();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function getMeta(db: DB, key: string): string | undefined {
  return get<{ value: string }>(db, 'SELECT value FROM meta WHERE key = ?', key)?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  run(
    db,
    'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
