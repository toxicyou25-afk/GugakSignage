/* SPDX-License-Identifier: Apache-2.0 */
import { all, get, run, transaction, type DB } from './db.js';
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
  WallSnapshot,
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
  wall?: WallSnapshot;
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
    ...(row.fit_mode_override ? { fitMode: row.fit_mode_override } : {}),
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

export function publishedScreenTargets(db: DB, device: DeviceRow): Array<{ displayId: string; nativeMonitorId: string | null }> {
  const publication = latestPublication(db, device.id);
  const snapshot = publication ? safeJsonParse<Snapshot>(publication.snapshot) : null;
  const assigned = snapshot?.wall?.displays.filter((display) => display.deviceId === device.id) ?? [];
  if (!assigned.length) return [];

  const legacyBindings = new Map(all<{ id: string; nativeMonitorId: string | null }>(
    db,
    'SELECT id, native_monitor_id AS nativeMonitorId FROM displays WHERE device_id = ?',
    device.id,
  ).map((display) => [display.id, display.nativeMonitorId]));
  return assigned.map((display) => ({
    displayId: display.id,
    nativeMonitorId: display.nativeMonitorId === undefined
      ? legacyBindings.get(display.id) ?? null
      : display.nativeMonitorId ?? null,
  }));
}

export function manifestForDevice(db: DB, device: DeviceRow): DeviceManifest {
  const publication = latestPublication(db, device.id);
  const snapshot = publication ? safeJsonParse<Snapshot>(publication.snapshot) : null;
  const ownDisplayIds = new Set(
    snapshot?.wall?.displays
      .filter((display) => display.deviceId === device.id)
      .map((display) => display.id) ?? [],
  );
  const wall = snapshot?.wall
    ? {
        ...snapshot.wall,
        displays: snapshot.wall.displays.map(({ nativeMonitorId: _nativeMonitorId, ...display }) => display),
        screens: snapshot.wall.screens.filter((screen) => ownDisplayIds.has(screen.displayId)),
      }
    : undefined;
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
    ...(wall ? { wall } : {}),
    serverTime: nowIso(),
  };
}

export function publishGroupSnapshot(
  db: DB,
  wall: WallSnapshot,
): { version: number; publishedAt: string; deviceIds: string[] } {
  const deviceIds = [...new Set(wall.displays.map((display) => display.deviceId).filter((value): value is string => Boolean(value)))];
  if (deviceIds.length === 0) {
    throw new PublishError('화면을 PC 기기에 한 대 이상 연결한 뒤 게시해 주세요.');
  }
  const publishedAt = nowIso();
  const snapshotWall: WallSnapshot = { ...wall, publishedAt };
  const fallbackPlaylist =
    wall.groupPlaylist ??
    wall.screens.find((screen) => screen.playlist.items.length > 0)?.playlist ??
    null;
  const snapshot: Snapshot = {
    defaultPlaylist: fallbackPlaylist,
    schedules: [],
    wall: snapshotWall,
  };
  let version = 0;
  transaction(db, () => {
    for (const deviceId of deviceIds) {
      const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', deviceId);
      if (!device) continue;
      const nextVersion = device.published_version + 1;
      run(
        db,
        'INSERT INTO publications(id, device_id, version, snapshot, published_at) VALUES (?, ?, ?, ?, ?)',
        id(),
        deviceId,
        nextVersion,
        JSON.stringify(snapshot),
        publishedAt,
      );
      run(
        db,
        'UPDATE devices SET published_version = ?, published_at = ?, updated_at = ? WHERE id = ?',
        nextVersion,
        publishedAt,
        publishedAt,
        deviceId,
      );
      version = Math.max(version, nextVersion);
    }
  });
  return { version, publishedAt, deviceIds };
}
