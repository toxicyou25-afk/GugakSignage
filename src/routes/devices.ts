/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { all, get, run, transaction, type DB } from '../db.js';
import { PublishError, publishDevice } from '../publishing.js';
import { ensureDeviceTopology } from '../topology-migration.js';
import type { DeviceRow, Orientation, PlaylistRow, ScheduleRow } from '../types.js';
import { asTrimmed, deviceStatus, id, newPairingCode, nowIso, parseIntRange } from '../util.js';

interface ScheduleDto {
  id: string;
  playlistId: string;
  playlistName: string;
  days: number[];
  startTime: string;
  endTime: string;
  enabled: boolean;
}

function scheduleDtos(db: DB, deviceId: string): ScheduleDto[] {
  const rows = all<ScheduleRow & { playlist_name: string }>(
    db,
    `SELECT s.*, p.name AS playlist_name
       FROM schedules s JOIN playlists p ON p.id = s.playlist_id
      WHERE s.device_id = ?
      ORDER BY s.start_time, s.id`,
    deviceId,
  );
  return rows.map((row) => ({
    id: row.id,
    playlistId: row.playlist_id,
    playlistName: row.playlist_name,
    days: row.days.split(',').map(Number).filter((day) => Number.isInteger(day)),
    startTime: row.start_time,
    endTime: row.end_time,
    enabled: Boolean(row.enabled),
  }));
}

function deviceDto(db: DB, config: AppConfig, device: DeviceRow) {
  const playlist = device.playlist_id
    ? get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', device.playlist_id)
    : undefined;
  const schedules = scheduleDtos(db, device.id);
  const site = device.site_id ? get<{ name: string }>(db, 'SELECT name FROM sites WHERE id = ?', device.site_id) : undefined;
  const displayCount = Number(get<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM displays WHERE device_id = ?',
    device.id,
  )?.n ?? 0);
  return {
    id: device.id,
    name: device.name,
    location: device.location,
    orientation: device.orientation,
    width: device.width,
    height: device.height,
    pairingCode: device.pairing_code,
    paired: Boolean(device.hardware_id),
    playlistId: device.playlist_id,
    playlistName: playlist?.name ?? null,
    publishedVersion: device.published_version,
    publishedAt: device.published_at,
    lastSeen: device.last_seen,
    playerState: device.player_state,
    lastError: device.last_error,
    reportedWidth: device.reported_width,
    reportedHeight: device.reported_height,
    notes: device.notes,
    createdAt: device.created_at,
    updatedAt: device.updated_at,
    status: deviceStatus(device, config.heartbeatOnlineMs),
    playerUrl: `/player/?code=${encodeURIComponent(device.pairing_code)}`,
    schedules,
    siteId: device.site_id,
    siteName: site?.name ?? null,
    displayCount,
  };
}

function uniquePairingCode(db: DB): string {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = newPairingCode();
    const existing = get<{ id: string }>(db, 'SELECT id FROM devices WHERE pairing_code = ?', code);
    if (!existing) return code;
  }
  throw new Error('등록 코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

function parseOrientation(value: unknown, fallback: Orientation): Orientation {
  return value === 'portrait' || value === 'landscape' ? value : fallback;
}

function getPlaylistOrNull(db: DB, raw: unknown): PlaylistRow | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null;
  const playlistId = asTrimmed(raw, 100);
  if (!playlistId) return null;
  return get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', playlistId);
}

interface ParsedSchedule {
  playlistId: string;
  days: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
}

function parseSchedules(db: DB, raw: unknown): ParsedSchedule[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: '시간표 형식이 올바르지 않습니다.' };
  const result: ParsedSchedule[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') return { error: `${index + 1}번째 시간표가 올바르지 않습니다.` };
    const value = entry as Record<string, unknown>;
    const playlistId = asTrimmed(value.playlistId, 100);
    if (!playlistId || !get<{ id: string }>(db, 'SELECT id FROM playlists WHERE id = ?', playlistId)) {
      return { error: `${index + 1}번째 시간표의 재생목록을 선택해 주세요.` };
    }
    const days = Array.isArray(value.days)
      ? [...new Set(value.days.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort()
      : [];
    if (days.length === 0) return { error: `${index + 1}번째 시간표에 요일을 하나 이상 선택해 주세요.` };
    const startTime = asTrimmed(value.startTime, 5);
    const endTime = asTrimmed(value.endTime, 5);
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
      return { error: `${index + 1}번째 시간표의 시작·종료 시각을 확인해 주세요.` };
    }
    if (startTime === endTime) {
      return { error: `${index + 1}번째 시간표의 시작과 종료 시각이 같습니다.` };
    }
    result.push({
      playlistId,
      days: days.join(','),
      startTime,
      endTime,
      enabled: value.enabled !== false,
    });
  }
  return result;
}

export function deviceRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = all<DeviceRow>(db, 'SELECT * FROM devices ORDER BY created_at ASC');
    res.json({ devices: rows.map((row) => deviceDto(db, config, row)) });
  });

  router.get('/:id', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    res.json({ device: deviceDto(db, config, device) });
  });

  router.post('/', (req, res) => {
    const name = asTrimmed(req.body?.name, 120);
    if (!name) {
      res.status(400).json({ error: '기기 이름을 입력해 주세요.' });
      return;
    }
    const orientation = parseOrientation(req.body?.orientation, 'landscape');
    const defaultWidth = orientation === 'portrait' ? 1080 : 1920;
    const defaultHeight = orientation === 'portrait' ? 1920 : 1080;
    const width = parseIntRange(req.body?.width, defaultWidth, 320, 7680);
    const height = parseIntRange(req.body?.height, defaultHeight, 320, 7680);
    const location = asTrimmed(req.body?.location, 200) || null;
    const notes = asTrimmed(req.body?.notes, 1000) || null;
    const playlist = getPlaylistOrNull(db, req.body?.playlistId);
    if (playlist === undefined) {
      res.status(400).json({ error: '선택한 재생목록을 찾을 수 없습니다.' });
      return;
    }
    const deviceId = id();
    const now = nowIso();
    const code = uniquePairingCode(db);
    run(
      db,
      `INSERT INTO devices(id, name, location, orientation, width, height, pairing_code, hardware_id,
                           player_token, playlist_id, published_version, published_at, last_seen, last_ip,
                           player_state, last_error, notes, reported_width, reported_height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      deviceId,
      name,
      location,
      orientation,
      width,
      height,
      code,
      playlist?.id ?? null,
      notes,
      now,
      now,
    );
    ensureDeviceTopology(db, deviceId);
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', deviceId);
    res.status(201).json({ device: device ? deviceDto(db, config, device) : null });
  });

  router.patch('/:id', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    const name = req.body?.name === undefined ? device.name : asTrimmed(req.body.name, 120);
    if (!name) {
      res.status(400).json({ error: '기기 이름을 입력해 주세요.' });
      return;
    }
    const orientation = req.body?.orientation === undefined ? device.orientation : parseOrientation(req.body.orientation, device.orientation);
    const width = req.body?.width === undefined ? device.width : parseIntRange(req.body.width, device.width, 320, 7680);
    const height = req.body?.height === undefined ? device.height : parseIntRange(req.body.height, device.height, 320, 7680);
    const location = req.body?.location === undefined ? device.location : asTrimmed(req.body.location, 200) || null;
    const notes = req.body?.notes === undefined ? device.notes : asTrimmed(req.body.notes, 1000) || null;
    run(
      db,
      `UPDATE devices SET name = ?, location = ?, orientation = ?, width = ?, height = ?, notes = ?, updated_at = ?
        WHERE id = ?`,
      name,
      location,
      orientation,
      width,
      height,
      notes,
      nowIso(),
      device.id,
    );
    const updated = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', device.id);
    res.json({ device: updated ? deviceDto(db, config, updated) : null });
  });

  router.put('/:id/assignment', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    const playlist = getPlaylistOrNull(db, req.body?.playlistId);
    if (playlist === undefined) {
      res.status(400).json({ error: '선택한 재생목록을 찾을 수 없습니다.' });
      return;
    }
    const parsed = parseSchedules(db, req.body?.schedules ?? []);
    if (!Array.isArray(parsed)) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!playlist && parsed.length === 0) {
      res.status(400).json({ error: '기본 재생목록이나 시간표 중 하나는 지정해 주세요.' });
      return;
    }
    const now = nowIso();
    transaction(db, () => {
      run(db, 'UPDATE devices SET playlist_id = ?, updated_at = ? WHERE id = ?', playlist?.id ?? null, now, device.id);
      run(db, 'DELETE FROM schedules WHERE device_id = ?', device.id);
      for (const schedule of parsed) {
        run(
          db,
          `INSERT INTO schedules(id, device_id, playlist_id, days, start_time, end_time, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id(),
          device.id,
          schedule.playlistId,
          schedule.days,
          schedule.startTime,
          schedule.endTime,
          schedule.enabled ? 1 : 0,
          now,
        );
      }
    });
    const updated = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', device.id);
    res.json({ device: updated ? deviceDto(db, config, updated) : null, republishRequired: true });
  });

  router.post('/:id/publish', (req, res) => {
    try {
      const published = publishDevice(db, req.params.id);
      const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
      res.json({
        ok: true,
        version: published.version,
        publishedAt: published.publishedAt,
        device: device ? deviceDto(db, config, device) : null,
      });
    } catch (error) {
      if (error instanceof PublishError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.post('/:id/regenerate-code', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    const code = uniquePairingCode(db);
    run(
      db,
      `UPDATE devices SET pairing_code = ?, hardware_id = NULL, player_token = NULL, last_seen = NULL,
             last_ip = NULL, player_state = NULL, last_error = NULL, updated_at = ?
        WHERE id = ?`,
      code,
      nowIso(),
      device.id,
    );
    const updated = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', device.id);
    res.json({ device: updated ? deviceDto(db, config, updated) : null });
  });

  router.post('/:id/unpair', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    run(
      db,
      `UPDATE devices SET hardware_id = NULL, player_token = NULL, last_seen = NULL, last_ip = NULL,
             player_state = NULL, last_error = NULL, updated_at = ?
        WHERE id = ?`,
      nowIso(),
      device.id,
    );
    const updated = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', device.id);
    res.json({ device: updated ? deviceDto(db, config, updated) : null });
  });

  router.delete('/:id', (req, res) => {
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', req.params.id);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    run(db, 'DELETE FROM devices WHERE id = ?', device.id);
    res.json({ ok: true });
  });

  return router;
}

export { deviceDto };
