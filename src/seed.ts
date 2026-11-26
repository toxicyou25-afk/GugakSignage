/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { get, run, setMeta, transaction, type DB } from './db.js';
import type { AppConfig } from './config.js';
import { publishDevice } from './publishing.js';
import { newPairingCode, newPlayerToken, nowIso } from './util.js';

interface SeedContent {
  key: string;
  name: string;
  file: string;
  kind: 'image' | 'video';
  mime: string;
  width: number | null;
  height: number | null;
}

const SEED_CONTENTS: SeedContent[] = [
  {
    key: 'poster-autumn',
    name: '가을 문화 행사 포스터',
    file: 'poster-autumn.png',
    kind: 'image',
    mime: 'image/png',
    width: 1920,
    height: 1080,
  },
  {
    key: 'poster-welcome',
    name: '안내센터 안내',
    file: 'poster-welcome.png',
    kind: 'image',
    mime: 'image/png',
    width: 1080,
    height: 1920,
  },
  {
    key: 'poster-class',
    name: '시민 체험 교실 포스터',
    file: 'poster-class.png',
    kind: 'image',
    mime: 'image/png',
    width: 1920,
    height: 1080,
  },
  {
    key: 'video-bbb',
    name: '샘플 영상 (Big Buck Bunny)',
    file: 'sample-video.mp4',
    kind: 'video',
    mime: 'video/mp4',
    width: 640,
    height: 360,
  },
];

export function migrateSampleCode(db: DB): boolean {
  // Early development builds used GUGK01 before the sample code was aligned to GUGAK1.
  const sample = get<{ id: string; pairing_code: string }>(
    db,
    "SELECT id, pairing_code FROM devices WHERE id = 'dev-sample-lobby'",
  );
  if (!sample || sample.pairing_code !== 'GUGK01') return false;
  const conflict = get<{ id: string }>(db, 'SELECT id FROM devices WHERE pairing_code = ?', 'GUGAK1');
  if (conflict) return false;
  run(db, 'UPDATE devices SET pairing_code = ?, updated_at = ? WHERE id = ?', 'GUGAK1', nowIso(), sample.id);
  return true;
}

export function seedDatabase(db: DB, config: AppConfig): { seeded: boolean; deviceId?: string; pairingCode?: string } {
  if (!config.seedSamples) return { seeded: false };
  const seeded = get<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'samples_seeded'");
  if (seeded) return { seeded: false };

  const sourceDir = path.join(config.rootDir, 'seed');
  if (!fs.existsSync(sourceDir)) return { seeded: false };
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const createdAt = nowIso();
  const contentIds = new Map<string, string>();
  const playlistId = 'pl-sample-lobby';
  const deviceId = 'dev-sample-lobby';
  let pairingCode = 'GUGAK1';
  const existingCode = get<{ id: string }>(db, 'SELECT id FROM devices WHERE pairing_code = ?', pairingCode);
  if (existingCode) pairingCode = newPairingCode();

  transaction(db, () => {
    for (const content of SEED_CONTENTS) {
      const source = path.join(sourceDir, content.file);
      if (!fs.existsSync(source)) continue;
      const storedName = `seed-${content.file.replace(/[^a-z0-9.]+/gi, '-')}`;
      const destination = path.join(config.uploadDir, storedName);
      if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
      const contentId = `ct-sample-${content.key}`;
      run(
        db,
        `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
        contentId,
        content.name,
        content.kind,
        content.mime,
        storedName,
        fs.statSync(destination).size,
        content.width,
        content.height,
        createdAt,
      );
      contentIds.set(content.key, contentId);
    }

    const noticeId = 'ct-sample-notice';
    run(
      db,
      `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
       VALUES (?, ?, 'url', NULL, NULL, ?, NULL, NULL, NULL, NULL, ?)`,
      noticeId,
      '오늘의 안내 (샘플 웹페이지)',
      '/sample/notice.html',
      createdAt,
    );
    contentIds.set('notice', noticeId);

    run(
      db,
      `INSERT INTO playlists(id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      playlistId,
      '로비 기본 순환',
      '기관 로비에서 이미지, 영상, 안내 웹페이지를 순서대로 재생합니다.',
      createdAt,
      createdAt,
    );

    const items: Array<[string, number, string, number, number]> = [
      [contentIds.get('poster-autumn') ?? '', 10, 'contain', 500, 1],
      [contentIds.get('poster-welcome') ?? '', 10, 'contain', 500, 1],
      [contentIds.get('video-bbb') ?? '', 10, 'contain', 300, 1],
      [contentIds.get('poster-class') ?? '', 10, 'contain', 500, 1],
      [contentIds.get('notice') ?? '', 12, 'contain', 300, 1],
    ];
    items.forEach(([contentId, duration, fit, transition, enabled], index) => {
      if (!contentId) return;
      run(
        db,
        `INSERT INTO playlist_items(id, playlist_id, content_id, position, duration_seconds, fit_mode,
                                    fit_mode_override, transition_ms, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `pli-sample-${index + 1}`,
        playlistId,
        contentId,
        index + 1,
        duration,
        fit,
        fit,
        transition,
        enabled,
      );
    });

    run(
      db,
      `INSERT INTO devices(id, name, location, orientation, width, height, pairing_code, hardware_id,
                           player_token, playlist_id, published_version, published_at, last_seen, last_ip,
                           player_state, last_error, notes, reported_width, reported_height, created_at, updated_at)
       VALUES (?, ?, ?, 'landscape', 1920, 1080, ?, NULL, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      deviceId,
      '로비 안내 화면',
      '1층 안내센터',
      pairingCode,
      newPlayerToken(),
      playlistId,
      '샘플 기기입니다. 관리 화면의 등록 코드를 재생기에 입력하세요.',
      createdAt,
      createdAt,
    );
    setMeta(db, 'samples_seeded', createdAt);
  });

  publishDevice(db, deviceId);
  return { seeded: true, deviceId, pairingCode };
}

export function seedSummary(db: DB): {
  contents: number;
  playlists: number;
  devices: number;
} {
  const count = (table: string): number =>
    Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
  return {
    contents: count('contents'),
    playlists: count('playlists'),
    devices: count('devices'),
  };
}
