/* SPDX-License-Identifier: Apache-2.0 */
import { all, get, run, type DB } from './db.js';
import type {
  ContentKind,
  DeviceManifest,
  DeviceRow,
  FitMode,
  ManifestItem,
  ManifestPlaylist,
  ManifestSchedule,
  PlaylistItemRow,
  PlaylistRow,
  PublicationRow,
  ScheduleRow,
} from './types.js';
import { id, nowIso, safeJsonParse } from './util.js';

export class PublishError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export interface Snapshot {
  defaultPlaylist: ManifestPlaylist | null;
  schedules: ManifestSchedule[];
}

interface ItemContentRow extends PlaylistItemRow {
  duration_seconds: number;
  fit_mode: FitMode;
  transition_ms: number;
  enabled: number;
  c_name: string;
  c_kind: ContentKind;
  c_mime: string | null;
  c_stored_name: string | null;
  c_external_url: string | null;
  c_width: number | null;
  c_height: number | null;
}

function mediaUrl(storedName: string | null): string | null {
  if (!storedName) return null;
  return `/media/${encodeURIComponent(storedName)}`;
}

export function buildPlaylist(db: DB, playlistId: string): ManifestPlaylist | null {
  const playlist = get<PlaylistRow>(db, 'SELECT * FROM playlists WHERE id = ?', playlistId);
  if (!playlist) return null;
  const rows = all<ItemContentRow>(
    db,
    `SELECT pi.*, c.name AS c_name, c.kind AS c_kind, c.mime AS c_mime,
            c.stored_name AS c_stored_name, c.external_url AS c_external_url,
            c.width AS c_width, c.height AS c_height
       FROM playlist_items pi
       JOIN contents c ON c.id = pi.content_id
      WHERE pi.playlist_id = ?
      ORDER BY pi.position ASC, pi.id ASC`,
    playlistId,
  );
  const items: ManifestItem[] = rows.map((row) => ({
    id: row.id,
    position: row.position,
    durationSeconds: row.duration_seconds,
    fitMode: row.fit_mode,
    transitionMs: row.transition_ms,
    enabled: Boolean(row.enabled),
    content: {
      id: row.content_id,
      name: row.c_name,
      kind: row.c_kind,
      mime: row.c_mime,
      url: row.c_kind === 'url' ? row.c_external_url : mediaUrl(row.c_stored_name),
      width: row.c_width,
      height: row.c_height,
    },
  }));
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    items,
  };
}

export function buildSnapshot(db: DB, device: DeviceRow): Snapshot {
  const defaultPlaylist = device.playlist_id ? buildPlaylist(db, device.playlist_id) : null;
  const scheduleRows = all<ScheduleRow>(
    db,
    'SELECT * FROM schedules WHERE device_id = ? AND enabled = 1 ORDER BY start_time, id',
    device.id,
  );
  const playlists = new Map<string, ManifestPlaylist | null>();
  const schedules: ManifestSchedule[] = [];
  for (const row of scheduleRows) {
    if (!playlists.has(row.playlist_id)) {
      playlists.set(row.playlist_id, buildPlaylist(db, row.playlist_id));
    }
    const playlist = playlists.get(row.playlist_id);
    if (!playlist) continue;
    schedules.push({
      id: row.id,
      days: row.days
        .split(',')
        .map((day) => Number.parseInt(day, 10))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      startTime: row.start_time,
      endTime: row.end_time,
      enabled: Boolean(row.enabled),
      playlist,
    });
  }
  if (!defaultPlaylist && schedules.length === 0) {
    throw new PublishError('게시할 재생목록이 없습니다. 기기에 재생목록을 먼저 지정해 주세요.');
  }
  return { defaultPlaylist, schedules };
}

export function publishDevice(db: DB, deviceId: string): {
  version: number;
  publishedAt: string;
  snapshot: Snapshot;
} {
  const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', deviceId);
  if (!device) throw new PublishError('기기를 찾을 수 없습니다.', 404);
  const snapshot = buildSnapshot(db, device);
  const version = device.published_version + 1;
  const publishedAt = nowIso();
  db.exec('BEGIN IMMEDIATE;');
  try {
    run(
      db,
      `INSERT INTO publications(id, device_id, version, snapshot, published_at)
       VALUES (?, ?, ?, ?, ?)`,
      id(),
      deviceId,
      version,
      JSON.stringify(snapshot),
      publishedAt,
    );
    run(
      db,
      'UPDATE devices SET published_version = ?, published_at = ?, updated_at = ? WHERE id = ?',
      version,
      publishedAt,
      publishedAt,
      deviceId,
    );
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  return { version, publishedAt, snapshot };
}

export function latestPublication(db: DB, deviceId: string): PublicationRow | undefined {
  return get<PublicationRow>(
    db,
    'SELECT * FROM publications WHERE device_id = ? ORDER BY version DESC LIMIT 1',
    deviceId,
  );
}

export function manifestForDevice(db: DB, device: DeviceRow): DeviceManifest {
  const publication = latestPublication(db, device.id);
  const snapshot = publication ? safeJsonParse<Snapshot>(publication.snapshot) : null;
  return {
    version: publication?.version ?? 0,
    publishedAt: publication?.published_at ?? null,
    defaultPlaylist: snapshot?.defaultPlaylist ?? null,
    schedules: snapshot?.schedules ?? [],
    device: {
      id: device.id,
      name: device.name,
      orientation: device.orientation,
      width: device.width,
      height: device.height,
    },
    serverTime: nowIso(),
  };
}
