/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type DB = DatabaseSync;

export function openDatabase(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
      transition_ms INTEGER NOT NULL DEFAULT 400,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist
      ON playlist_items(playlist_id, position);

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
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      published_version INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      last_seen TEXT,
      last_ip TEXT,
      player_state TEXT,
      last_error TEXT,
      notes TEXT,
      reported_width INTEGER,
      reported_height INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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
