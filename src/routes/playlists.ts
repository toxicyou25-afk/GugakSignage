/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import { all, get, run, transaction, type DB } from '../db.js';
import { buildPlaylist } from '../publishing.js';
import type { FitMode, PlaylistItemInput, PlaylistItemRow, PlaylistRow } from '../types.js';
import { asTrimmed, id, nowIso, parseIntRange } from '../util.js';

const FITS = new Set<FitMode>(['contain', 'cover', 'stretch']);

function parseItems(raw: unknown): PlaylistItemInput[] | { error: string } {
  if (!Array.isArray(raw)) return { error: '재생 항목 목록이 올바르지 않습니다.' };
  const items: PlaylistItemInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return { error: `${index + 1}번째 항목이 올바르지 않습니다.` };
    const value = item as Record<string, unknown>;
    const contentId = asTrimmed(value.contentId, 100);
    if (!contentId) return { error: `${index + 1}번째 항목의 콘텐츠를 선택해 주세요.` };
    const fitMode = String(value.fitMode ?? 'contain') as FitMode;
    if (!FITS.has(fitMode)) return { error: `${index + 1}번째 항목의 맞춤 방식이 올바르지 않습니다.` };
    items.push({
      contentId,
      durationSeconds: parseIntRange(value.durationSeconds, 10, 3, 3600),
      fitMode,
      transitionMs: parseIntRange(value.transitionMs, 400, 0, 3000),
      enabled: value.enabled !== false,
    });
  }
  return items;
}

function itemDto(row: PlaylistItemRow) {
  return {
    id: row.id,
    contentId: row.content_id,
    position: row.position,
    durationSeconds: row.duration_seconds,
    fitMode: row.fit_mode,
    transitionMs: row.transition_ms,
    enabled: Boolean(row.enabled),
    content: {
      id: row.content_id,
      name: row.name,
      kind: row.kind,
      mime: row.mime,
      url:
        row.kind === 'url'
          ? row.external_url
          : row.stored_name
            ? `/media/${encodeURIComponent(row.stored_name)}`
            : null,
      width: row.width,
      height: row.height,
    },
  };
}

function itemsFor(db: DB, playlistId: string) {
  return all<PlaylistItemRow>(
    db,
    `SELECT pi.*, c.name, c.kind, c.mime, c.stored_name, c.external_url, c.width, c.height
       FROM playlist_items pi
       JOIN contents c ON c.id = pi.content_id
      WHERE pi.playlist_id = ?
      ORDER BY pi.position, pi.id`,
    playlistId,
  ).map(itemDto);
}

export function playlistRoutes(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = all<PlaylistRow & { item_count: number; total_seconds: number; device_count: number }>(
      db,
      `SELECT p.*,
              (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.enabled = 1) AS item_count,
              (SELECT COALESCE(SUM(pi.duration_seconds), 0) FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.enabled = 1) AS total_seconds,
              (SELECT COUNT(*) FROM devices d WHERE d.playlist_id = p.id) AS device_count
         FROM playlists p
        ORDER BY p.updated_at DESC`,
    );
    res.json({ playlists: rows });
  });

  router.get('/:id', (req, res) => {
    const playlist = get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', req.params.id);
    if (!playlist) {
      res.status(404).json({ error: '재생목록을 찾을 수 없습니다.' });
      return;
    }
    res.json({ playlist, items: itemsFor(db, playlist.id) });
  });

  router.post('/', (req, res) => {
    const name = asTrimmed(req.body?.name, 120);
    if (!name) {
      res.status(400).json({ error: '재생목록 이름을 입력해 주세요.' });
      return;
    }
    const description = asTrimmed(req.body?.description, 500) || null;
    const now = nowIso();
    const playlistId = id();
    run(
      db,
      'INSERT INTO playlists(id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      playlistId,
      name,
      description,
      now,
      now,
    );
    res.status(201).json({ playlist: get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', playlistId), items: [] });
  });

  router.put('/:id', (req, res) => {
    const playlist = get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', req.params.id);
    if (!playlist) {
      res.status(404).json({ error: '재생목록을 찾을 수 없습니다.' });
      return;
    }
    const name = asTrimmed(req.body?.name, 120);
    if (!name) {
      res.status(400).json({ error: '재생목록 이름을 입력해 주세요.' });
      return;
    }
    const description = asTrimmed(req.body?.description, 500) || null;
    const parsed = parseItems(req.body?.items);
    if (!Array.isArray(parsed)) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    for (const item of parsed) {
      const content = get<{ id: string }>(db, 'SELECT id FROM contents WHERE id = ?', item.contentId);
      if (!content) {
        res.status(400).json({ error: '재생목록에 없는 콘텐츠가 포함되어 있습니다. 새로고침 후 다시 시도해 주세요.' });
        return;
      }
    }
    const now = nowIso();
    transaction(db, () => {
      run(db, 'UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?', name, description, now, playlist.id);
      run(db, 'DELETE FROM playlist_items WHERE playlist_id = ?', playlist.id);
      parsed.forEach((item, index) => {
        run(
          db,
          `INSERT INTO playlist_items(id, playlist_id, content_id, position, duration_seconds, fit_mode, transition_ms, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id(),
          playlist.id,
          item.contentId,
          index + 1,
          item.durationSeconds,
          item.fitMode,
          item.transitionMs,
          item.enabled ? 1 : 0,
        );
      });
    });
    res.json({
      playlist: get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', playlist.id),
      items: itemsFor(db, playlist.id),
      manifestPreview: buildPlaylist(db, playlist.id),
    });
  });

  router.delete('/:id', (req, res) => {
    const playlist = get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', req.params.id);
    if (!playlist) {
      res.status(404).json({ error: '재생목록을 찾을 수 없습니다.' });
      return;
    }
    const devices = all<{ name: string }>(db, 'SELECT name FROM devices WHERE playlist_id = ?', playlist.id);
    const scheduled = all<{ name: string }>(
      db,
      `SELECT DISTINCT d.name FROM schedules s JOIN devices d ON d.id = s.device_id WHERE s.playlist_id = ?`,
      playlist.id,
    );
    const topologyUsage = Number(get<{ n: number }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM display_groups WHERE playlist_id = ?) +
         (SELECT COUNT(*) FROM displays WHERE playlist_id = ?) AS n`,
      playlist.id,
      playlist.id,
    )?.n ?? 0);
    const usage = [...new Map([...devices, ...scheduled].map((row) => [row.name, row])).keys()];
    if (usage.length > 0 || topologyUsage > 0) {
      res.status(409).json({
        error: usage.length > 0
          ? `이 재생목록은 ${usage.map((name) => `‘${name}’`).join(', ')} 기기에서 사용 중입니다. 기기의 재생 설정을 바꾼 뒤 삭제해 주세요.`
          : '이 재생목록은 장소·화면 배치에서 사용 중입니다. 화면별 배정과 그룹 기본 재생목록을 바꾼 뒤 삭제해 주세요.',
      });
      return;
    }
    run(db, 'DELETE FROM playlists WHERE id = ?', playlist.id);
    res.json({ ok: true });
  });

  return router;
}
