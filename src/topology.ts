// SPDX-License-Identifier: Apache-2.0
import { all, get, run, transaction, type DB } from './db.js';
import { engine, type EngineLayout, type RenderPlan } from './engine.js';
import { buildPlaylist } from './publishing.js';
import type {
  DeviceRow,
  DisplayGroupRow,
  DisplayRotation,
  DisplayRow,
  FitMode,
  LayoutRow,
  LayoutType,
  ManifestPlaylist,
  Orientation,
  PlaybackMode,
  SiteRow,
  WallScreen,
  WallSnapshot,
} from './types.js';
import { deviceStatus, id, nowIso, parseIntRange, safeJsonParse } from './util.js';

const PLAYBACK_MODES: PlaybackMode[] = ['individual', 'synchronized-cycle', 'mirror', 'canvas'];
const LAYOUT_TYPES: LayoutType[] = ['single', 'row', 'column', 'grid', 'custom'];
const ORIENTATIONS: Orientation[] = ['landscape', 'portrait'];
const ROTATIONS: DisplayRotation[] = [0, 90, 180, 270];
const FIT_MODES: FitMode[] = ['contain', 'cover', 'stretch'];

export interface GroupConfigurationInput {
  displayCount: number;
  width: number;
  height: number;
  orientation: Orientation;
  rotation: DisplayRotation;
  layoutType: LayoutType;
  columns?: number;
  rows?: number;
  gap: number;
  deviceId: string | null;
  playlistId: string | null;
  playbackMode: PlaybackMode;
  dwellMs: number;
  fitMode: FitMode;
  resetEpoch: boolean;
}

function emptyPlaylist(groupId: string): ManifestPlaylist {
  return { id: `empty-${groupId}`, name: '배정 없음', description: null, items: [] };
}

function playlistCache(db: DB): (playlistId: string | null) => ManifestPlaylist {
  const cache = new Map<string, ManifestPlaylist>();
  return (playlistId) => {
    if (!playlistId) return emptyPlaylist('unassigned');
    if (!cache.has(playlistId)) {
      cache.set(playlistId, buildPlaylist(db, playlistId) ?? emptyPlaylist(playlistId));
    }
    return cache.get(playlistId)!;
  };
}

function layoutFromRow(row: LayoutRow): EngineLayout {
  const slots = safeJsonParse<EngineLayout['slots']>(row.slots_json) ?? [];
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    gap: row.gap,
    bezel: row.bezel,
    slots,
  };
}

function deviceStatusFor(db: DB, configHeartbeatMs: number, deviceId: string | null) {
  if (!deviceId) return null;
  const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', deviceId);
  return device ? deviceStatus(device, configHeartbeatMs) : null;
}

function linkDeviceToGroup(
  db: DB,
  deviceId: string | null,
  siteId: string,
  groupId: string,
  exceptDisplayId?: string,
): void {
  if (!deviceId) return;
  run(
    db,
    `UPDATE displays SET device_id = NULL, native_monitor_id = NULL, updated_at = ?
      WHERE device_id = ? AND id <> ? AND (site_id <> ? OR group_id <> ?)`,
    nowIso(),
    deviceId,
    exceptDisplayId ?? '',
    siteId,
    groupId,
  );
  run(db, 'UPDATE devices SET site_id = ? WHERE id = ?', siteId, deviceId);
}

export function buildWallSnapshot(
  db: DB,
  groupId: string,
  options: { publishedAt?: string | null; heartbeatOnlineMs?: number } = {},
): WallSnapshot {
  const group = get<DisplayGroupRow>(db, 'SELECT * FROM display_groups WHERE id = ?', groupId);
  if (!group) throw new Error('화면 그룹을 찾을 수 없습니다.');
  const site = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', group.site_id);
  const layoutRow = get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', group.layout_id);
  if (!site || !layoutRow) throw new Error('장소 또는 배치를 찾을 수 없습니다.');
  const displays = all<DisplayRow>(
    db,
    'SELECT * FROM displays WHERE group_id = ? AND enabled = 1 ORDER BY start_index, created_at, rowid',
    group.id,
  );
  const getPlaylist = playlistCache(db);
  const groupPlaylist = buildPlaylist(db, group.playlist_id ?? '');
  const screens: WallScreen[] = displays.map((display) => {
    const screenPlaylistId =
      group.playback_mode === 'canvas' || group.playback_mode === 'mirror'
        ? group.playlist_id
        : display.playlist_id ?? group.playlist_id;
    const playlist = group.playback_mode === 'canvas' || group.playback_mode === 'mirror'
      ? groupPlaylist ?? emptyPlaylist(group.id)
      : getPlaylist(screenPlaylistId);
    return { displayId: display.id, playlistId: screenPlaylistId, playlist };
  });
  return {
    schemaVersion: 2,
    publishedAt: options.publishedAt ?? null,
    site: {
      id: site.id,
      name: site.name,
      timezone: site.timezone,
      notes: site.notes,
    },
    group: {
      id: group.id,
      siteId: group.site_id,
      name: group.name,
      layoutId: group.layout_id,
      playlistId: group.playlist_id,
      playbackMode: group.playback_mode,
      epoch: group.epoch,
      settings: { dwellMs: group.dwell_ms, transitionMs: 0 },
    },
    layout: layoutFromRow(layoutRow),
    displays: displays.map((display, index) => ({
      id: display.id,
      deviceId: display.device_id,
      nativeMonitorId: display.native_monitor_id,
      groupId: display.group_id,
      name: display.name,
      resolution: { width: display.width, height: display.height },
      orientation: display.orientation,
      rotation: display.rotation,
      fit: display.fit_mode,
      slotId: display.slot_id,
      startIndex: display.start_index ?? index,
      step: display.step,
      status: deviceStatusFor(db, options.heartbeatOnlineMs ?? 45_000, display.device_id),
    })),
    screens,
    groupPlaylist,
    dwellMs: group.dwell_ms,
  };
}

export function engineSnapshotForWall(wall: WallSnapshot, displayId: string): Record<string, unknown> {
  return engine.wallScreenInput(wall as unknown as Record<string, unknown>, displayId);
}

export function buildWallPlans(wall: WallSnapshot, atMs = Date.now()): RenderPlan[] {
  return wall.screens.map((screen) =>
    engine.buildRenderPlan(engineSnapshotForWall(wall, screen.displayId), screen.displayId, atMs),
  );
}

export function previewWall(
  db: DB,
  groupId: string,
  options: { atMs?: number; heartbeatOnlineMs?: number } = {},
) {
  const wall = buildWallSnapshot(db, groupId, { heartbeatOnlineMs: options.heartbeatOnlineMs });
  const atMs = Number.isFinite(options.atMs) ? options.atMs! : Date.now();
  return {
    wall,
    plans: buildWallPlans(wall, atMs),
    atMs,
    serverTime: new Date(atMs).toISOString(),
    layoutValidation: engine.validateLayout(wall.layout),
  };
}

function createLayoutForSite(
  db: DB,
  siteId: string,
  displayCount: number,
  width: number,
  height: number,
  layoutType: LayoutType,
  columns?: number,
  rows?: number,
  gap = 0.01,
): EngineLayout {
  const layoutId = id();
  const layout = engine.buildLayout({
    id: layoutId,
    name: displayCount === 1 ? '단일 화면 배치' : `${displayCount}화면 배치`,
    type: displayCount === 1 ? 'single' : layoutType === 'single' ? 'grid' : layoutType,
    displayCount: Math.max(1, displayCount),
    columns,
    rows,
    gap: displayCount === 1 ? 0 : gap,
    canvasWidth: displayCount === 1 ? width : undefined,
    canvasHeight: displayCount === 1 ? height : undefined,
  });
  const now = nowIso();
  run(
    db,
    `INSERT INTO layouts(id, site_id, name, type, canvas_width, canvas_height, gap, bezel,
                         slots_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    layoutId,
    siteId,
    layout.name,
    layout.type,
    layout.canvasWidth,
    layout.canvasHeight,
    layout.gap,
    layout.bezel,
    JSON.stringify(layout.slots),
    now,
    now,
  );
  return layout;
}

export function createSite(
  db: DB,
  input: { name: string; timezone?: string; notes?: string | null },
): { site: SiteRow; group: DisplayGroupRow; layout: LayoutRow } {
  return transaction(db, () => {
    const now = nowIso();
    const siteId = id();
    const groupId = id();
    run(
      db,
      'INSERT INTO sites(id, name, timezone, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      siteId,
      input.name,
      input.timezone || 'Asia/Seoul',
      input.notes ?? null,
      now,
      now,
    );
    const layout = createLayoutForSite(db, siteId, 1, 1920, 1080, 'single');
    run(
      db,
      `INSERT INTO display_groups(id, site_id, name, layout_id, playlist_id, playback_mode,
                                  epoch, dwell_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'synchronized-cycle', ?, 10000, ?, ?)`,
      groupId,
      siteId,
      '기본 화면 그룹',
      layout.id,
      now,
      now,
      now,
    );
    run(
      db,
      `INSERT INTO displays(id, site_id, group_id, device_id, playlist_id, name, width, height,
                            orientation, rotation, fit_mode, slot_id, start_index, step, enabled,
                            created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, 1920, 1080, 'landscape', 0, 'contain', ?, 0, 1, 1, ?, ?)`,
      id(),
      siteId,
      groupId,
      '화면 1',
      layout.slots[0]?.id ?? 'slot-1',
      now,
      now,
    );
    return {
      site: get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', siteId)!,
      group: get<DisplayGroupRow>(db, 'SELECT * FROM display_groups WHERE id = ?', groupId)!,
      layout: get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', layout.id)!,
    };
  });
}

export function createDisplayGroup(db: DB, siteId: string, name: string): DisplayGroupRow {
  const site = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', siteId);
  if (!site) throw new Error('장소를 찾을 수 없습니다.');
  return transaction(db, () => {
    const now = nowIso();
    const layout = createLayoutForSite(db, site.id, 1, 1920, 1080, 'single');
    const groupId = id();
    run(
      db,
      `INSERT INTO display_groups(id, site_id, name, layout_id, playlist_id, playback_mode,
                                  epoch, dwell_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'synchronized-cycle', ?, 10000, ?, ?)`,
      groupId,
      site.id,
      name,
      layout.id,
      now,
      now,
      now,
    );
    run(
      db,
      `INSERT INTO displays(id, site_id, group_id, device_id, playlist_id, name, width, height,
                            orientation, rotation, fit_mode, slot_id, start_index, step, enabled,
                            created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, '화면 1', 1920, 1080, 'landscape', 0, 'contain', ?, 0, 1, 1, ?, ?)`,
      id(),
      site.id,
      groupId,
      layout.slots[0]?.id ?? 'slot-1',
      now,
      now,
    );
    return get<DisplayGroupRow>(db, 'SELECT * FROM display_groups WHERE id = ?', groupId)!;
  });
}

export function configureGroupDisplays(
  db: DB,
  groupId: string,
  input: GroupConfigurationInput,
): void {
  const group = get<DisplayGroupRow>(db, 'SELECT * FROM display_groups WHERE id = ?', groupId);
  if (!group) throw new Error('화면 그룹을 찾을 수 없습니다.');
  if (!Number.isInteger(input.displayCount) || input.displayCount < 1 || input.displayCount > 256) {
    throw new Error('모니터 수는 1개 이상의 정수로 입력해 주세요.');
  }
  if (!ORIENTATIONS.includes(input.orientation)) throw new Error('화면 방향이 올바르지 않습니다.');
  if (!ROTATIONS.includes(input.rotation)) throw new Error('회전 값은 0, 90, 180, 270 중 하나여야 합니다.');
  if (!FIT_MODES.includes(input.fitMode)) throw new Error('맞춤 방식이 올바르지 않습니다.');
  if (!PLAYBACK_MODES.includes(input.playbackMode)) throw new Error('재생 모드가 올바르지 않습니다.');
  if (!LAYOUT_TYPES.includes(input.layoutType)) throw new Error('배치 형식이 올바르지 않습니다.');
  if (input.displayCount > 1 && input.layoutType === 'single') {
    throw new Error('모니터가 2대 이상이면 단일 배치 대신 가로·세로·격자 배치를 선택해 주세요.');
  }
  if (input.deviceId && !get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', input.deviceId)) {
    throw new Error('선택한 PC 기기를 찾을 수 없습니다.');
  }
  if (input.playlistId && !get<{ id: string }>(db, 'SELECT id FROM playlists WHERE id = ?', input.playlistId)) {
    throw new Error('선택한 재생목록을 찾을 수 없습니다.');
  }
  const layoutRow = get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', group.layout_id);
  if (!layoutRow) throw new Error('배치를 찾을 수 없습니다.');

  transaction(db, () => {
    const now = nowIso();
    const existing = all<DisplayRow>(
      db,
      'SELECT * FROM displays WHERE group_id = ? ORDER BY start_index, created_at, rowid',
      group.id,
    );
    const addedCount = Math.max(0, input.displayCount - existing.length);
    const fillsUnassignedScreen = existing
      .slice(0, input.displayCount)
      .some((display) => display.device_id === null);
    if (addedCount > 0 || fillsUnassignedScreen) {
      // A group-level PC fills new or never-assigned screens. Existing
      // screen-to-PC assignments change through the explicit display endpoint.
      linkDeviceToGroup(db, input.deviceId, group.site_id, group.id);
    }
    if (existing.length > input.displayCount) {
      for (const display of existing.slice(input.displayCount)) {
        run(db, 'DELETE FROM displays WHERE id = ?', display.id);
      }
    }
    for (let index = existing.length; index < input.displayCount; index += 1) {
      run(
        db,
        `INSERT INTO displays(id, site_id, group_id, device_id, playlist_id, name, width, height,
                              orientation, rotation, fit_mode, slot_id, start_index, step, enabled,
                              created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1, 1, ?, ?)`,
        id(),
        group.site_id,
        group.id,
        input.deviceId,
        input.playlistId,
        `화면 ${index + 1}`,
        input.width,
        input.height,
        input.orientation,
        input.rotation,
        input.fitMode,
        index,
        now,
        now,
      );
    }
    const effectiveLayoutType = input.displayCount === 1 ? 'single' : input.layoutType;
    const layout = engine.buildLayout({
      id: layoutRow.id,
      name: input.displayCount === 1 ? '단일 화면 배치' : `${input.displayCount}화면 ${input.layoutType} 배치`,
      type: effectiveLayoutType,
      displayCount: input.displayCount,
      columns: input.columns,
      rows: input.rows,
      gap: input.displayCount === 1 ? 0 : input.gap,
      canvasWidth: input.displayCount === 1 ? input.width : undefined,
      canvasHeight: input.displayCount === 1 ? input.height : undefined,
    });
    run(
      db,
      `UPDATE layouts SET name = ?, type = ?, canvas_width = ?, canvas_height = ?, gap = ?,
                          slots_json = ?, updated_at = ? WHERE id = ?`,
      layout.name,
      layout.type,
      layout.canvasWidth,
      layout.canvasHeight,
      layout.gap,
      JSON.stringify(layout.slots),
      now,
      layout.id,
    );
    const displays = all<DisplayRow>(
      db,
      'SELECT * FROM displays WHERE group_id = ? ORDER BY start_index, created_at, rowid',
      group.id,
    );
    displays.forEach((display, index) => {
      run(
        db,
        `UPDATE displays SET width = ?, height = ?, orientation = ?, rotation = ?, fit_mode = ?,
                              device_id = COALESCE(device_id, ?), playlist_id = ?, name = ?, slot_id = ?, start_index = ?,
                              updated_at = ? WHERE id = ?`,
        input.width,
        input.height,
        input.orientation,
        input.rotation,
        input.fitMode,
        input.deviceId,
        display.playlist_id ?? input.playlistId,
        display.name || `화면 ${index + 1}`,
        layout.slots[index]?.id ?? '',
        index,
        now,
        display.id,
      );
    });
    run(
      db,
      `UPDATE display_groups SET playlist_id = ?, playback_mode = ?, dwell_ms = ?, epoch = ?,
                                updated_at = ? WHERE id = ?`,
      input.playlistId,
      input.playbackMode,
      input.dwellMs,
      input.resetEpoch ? now : group.epoch,
      now,
      group.id,
    );
  });
}

export function updateDisplay(
  db: DB,
  displayId: string,
  heartbeatOnlineMs: number,
  input: {
    name?: string;
    playlistId?: string | null;
    width?: number;
    height?: number;
    orientation?: Orientation;
    rotation?: DisplayRotation;
    fitMode?: FitMode;
    deviceId?: string | null;
    nativeMonitorId?: string | null;
    startIndex?: number;
    step?: number;
  },
): void {
  const display = get<DisplayRow>(db, 'SELECT * FROM displays WHERE id = ?', displayId);
  if (!display) throw new Error('모니터를 찾을 수 없습니다.');
  if (input.playlistId && !get<{ id: string }>(db, 'SELECT id FROM playlists WHERE id = ?', input.playlistId)) {
    throw new Error('선택한 재생목록을 찾을 수 없습니다.');
  }
  if (input.deviceId && !get<{ id: string }>(db, 'SELECT id FROM devices WHERE id = ?', input.deviceId)) {
    throw new Error('선택한 PC 기기를 찾을 수 없습니다.');
  }
  const width = input.width ?? display.width;
  const height = input.height ?? display.height;
  const orientation = input.orientation ?? display.orientation;
  const rotation = input.rotation ?? display.rotation;
  const fitMode = input.fitMode ?? display.fit_mode;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 320 || width > 16384 || height > 16384) {
    throw new Error('화면 해상도는 320~16384px 범위로 입력해 주세요.');
  }
  if (!ORIENTATIONS.includes(orientation) || !ROTATIONS.includes(rotation) || !FIT_MODES.includes(fitMode)) {
    throw new Error('모니터 표시 설정을 확인해 주세요.');
  }
  const finalDeviceId = input.deviceId === undefined ? display.device_id : input.deviceId;
  const requestedNativeMonitorId = input.nativeMonitorId === undefined
    ? display.native_monitor_id
    : input.nativeMonitorId;
  if (input.nativeMonitorId !== undefined && requestedNativeMonitorId !== null && !finalDeviceId) {
    throw new Error('물리 모니터를 지정하려면 먼저 PC 기기를 연결해 주세요.');
  }
  const finalDevice = finalDeviceId
    ? get<{ last_host_local: number; last_seen: string | null }>(db, 'SELECT last_host_local, last_seen FROM devices WHERE id = ?', finalDeviceId)
    : undefined;
  const finalDeviceLastSeen = finalDevice?.last_seen ? Date.parse(finalDevice.last_seen) : Number.NaN;
  const finalDeviceHeartbeatAge = Date.now() - finalDeviceLastSeen;
  const finalDeviceIsLocalHost = finalDevice?.last_host_local === 1 && Number.isFinite(finalDeviceLastSeen) &&
    finalDeviceHeartbeatAge >= 0 && finalDeviceHeartbeatAge <= heartbeatOnlineMs;
  const report = finalDeviceId ? get<{ snapshot_json: string }>(db,
    'SELECT snapshot_json FROM player_monitor_reports WHERE device_id = ?', finalDeviceId) : undefined;
  let reportedBinding = false;
  if (requestedNativeMonitorId && report) {
    try { reportedBinding = (JSON.parse(report.snapshot_json) as Array<{ bindingId?: unknown }>).some((monitor) => monitor.bindingId === requestedNativeMonitorId); }
    catch { reportedBinding = false; }
  }
  const finalDeviceOnline = Boolean(finalDevice && Number.isFinite(finalDeviceLastSeen) && finalDeviceHeartbeatAge >= 0 && finalDeviceHeartbeatAge <= heartbeatOnlineMs);
  const canBindMonitor = finalDeviceIsLocalHost || (finalDevice?.last_host_local === 0 && finalDeviceOnline && reportedBinding);
  const sameDevice = finalDeviceId === display.device_id;
  const bindingChanged = input.nativeMonitorId !== undefined && requestedNativeMonitorId !== display.native_monitor_id;
  if (input.nativeMonitorId && bindingChanged && !canBindMonitor) {
    throw new Error('원격 Player의 모니터 배정은 해당 PC의 모니터 정보가 연결된 뒤에 지정할 수 있습니다.');
  }
  const nativeMonitorId = sameDevice
    ? (input.nativeMonitorId === undefined ? display.native_monitor_id : requestedNativeMonitorId)
    : (input.nativeMonitorId !== undefined && canBindMonitor ? requestedNativeMonitorId ?? null : null);
  if (nativeMonitorId) {
    const duplicate = get<{ id: string }>(
      db,
      'SELECT id FROM displays WHERE device_id = ? AND native_monitor_id = ? AND id <> ?',
      finalDeviceId,
      nativeMonitorId,
      display.id,
    );
    if (duplicate) throw new Error('같은 PC의 다른 화면에 이미 연결된 물리 모니터입니다.');
  }
  transaction(db, () => {
    if (input.deviceId !== undefined) {
      linkDeviceToGroup(db, finalDeviceId, display.site_id, display.group_id, display.id);
    }
    if (finalDeviceId !== display.device_id) {
      run(db, 'UPDATE displays SET device_id = ?, native_monitor_id = NULL, updated_at = ? WHERE id = ?',
        finalDeviceId, nowIso(), display.id);
    }
    run(
      db,
      `UPDATE displays SET name = ?, playlist_id = ?, width = ?, height = ?, orientation = ?,
                            rotation = ?, fit_mode = ?, device_id = ?, native_monitor_id = ?, start_index = ?, step = ?,
                            updated_at = ? WHERE id = ?`,
      input.name?.trim() || display.name,
      input.playlistId === undefined ? display.playlist_id : input.playlistId || null,
      width,
      height,
      orientation,
      rotation,
      fitMode,
      finalDeviceId,
      nativeMonitorId,
      typeof input.startIndex === 'number' && Number.isInteger(input.startIndex) ? input.startIndex : display.start_index,
      typeof input.step === 'number' && Number.isInteger(input.step) ? input.step : display.step,
      nowIso(),
      display.id,
    );
    if (finalDeviceId) run(db, 'UPDATE devices SET site_id = ? WHERE id = ?', display.site_id, finalDeviceId);
  });
}

export function siteSummary(db: DB) {
  const sites = all<SiteRow>(db, 'SELECT * FROM sites ORDER BY created_at, rowid').map((site) => {
    const groups = all<DisplayGroupRow>(
      db,
      'SELECT * FROM display_groups WHERE site_id = ? ORDER BY created_at, rowid',
      site.id,
    );
    const displays = all<DisplayRow>(
      db,
      'SELECT * FROM displays WHERE site_id = ? ORDER BY group_id, start_index, created_at, rowid',
      site.id,
    );
    return {
      ...site,
      groupCount: groups.length,
      displayCount: displays.length,
      assignedDeviceCount: new Set(displays.map((display) => display.device_id).filter(Boolean)).size,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
    };
  });
  return { sites };
}

export function siteDetail(db: DB, siteId: string, heartbeatOnlineMs: number) {
  const site = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', siteId);
  if (!site) return null;
  const deviceDto = (device: DeviceRow) => {
    const status = deviceStatus(device, heartbeatOnlineMs);
    const lastSeen = device.last_seen ? Date.parse(device.last_seen) : Number.NaN;
    const heartbeatAge = Date.now() - lastSeen;
    return {
      id: device.id,
      name: device.name,
      localHost: device.last_host_local === 1 && Number.isFinite(lastSeen) &&
        heartbeatAge >= 0 && heartbeatAge <= heartbeatOnlineMs,
      status,
      displayCount: Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays WHERE device_id = ?', device.id)?.n ?? 0),
    };
  };
  const groups = all<DisplayGroupRow>(
    db,
    'SELECT * FROM display_groups WHERE site_id = ? ORDER BY created_at, rowid',
    siteId,
  ).map((group) => {
    const layout = get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', group.layout_id);
    const displays = all<DisplayRow>(
      db,
      'SELECT * FROM displays WHERE group_id = ? ORDER BY start_index, created_at, rowid',
      group.id,
    ).map((display) => {
      const status = deviceStatusFor(db, heartbeatOnlineMs, display.device_id);
      const displayDevice = display.device_id
        ? get<{ last_host_local: number; last_seen: string | null }>(db, 'SELECT last_host_local, last_seen FROM devices WHERE id = ?', display.device_id)
        : undefined;
      const displayLastSeen = displayDevice?.last_seen ? Date.parse(displayDevice.last_seen) : Number.NaN;
      const displayHeartbeatAge = Date.now() - displayLastSeen;
      const localHost = displayDevice?.last_host_local === 1 && Number.isFinite(displayLastSeen) &&
        displayHeartbeatAge >= 0 && displayHeartbeatAge <= heartbeatOnlineMs;
      const { native_monitor_id: _nativeMonitorId, ...displayData } = display;
      return {
        ...displayData,
        nativeMonitorId: display.native_monitor_id,
        localHost,
        status,
        deviceName: display.device_id
          ? get<{ name: string }>(db, 'SELECT name FROM devices WHERE id = ?', display.device_id)?.name ?? null
          : null,
        playlistName: display.playlist_id
          ? get<{ name: string }>(db, 'SELECT name FROM playlists WHERE id = ?', display.playlist_id)?.name ?? null
          : null,
      };
    });
    const availableDevices = all<DeviceRow>(
      db,
      `SELECT * FROM devices d
        WHERE (d.site_id = ? OR d.site_id IS NULL)
          AND (
            NOT EXISTS (SELECT 1 FROM displays assigned WHERE assigned.device_id = d.id)
            OR EXISTS (SELECT 1 FROM displays own WHERE own.device_id = d.id AND own.group_id = ?)
          )
        ORDER BY d.created_at, d.rowid`,
      siteId,
      group.id,
    );
    return {
      ...group,
      layout: layout ? layoutFromRow(layout) : null,
      displays,
      devices: availableDevices.map(deviceDto),
    };
  });
  const devices = all<DeviceRow>(
    db,
    'SELECT * FROM devices WHERE site_id = ? OR site_id IS NULL ORDER BY created_at, rowid',
    siteId,
  ).map(deviceDto);
  return { site, groups, devices };
}

export function parseGroupConfiguration(raw: Record<string, unknown>, current?: { width?: number; height?: number }): GroupConfigurationInput {
  const orientation: Orientation = raw.orientation === 'portrait' ? 'portrait' : 'landscape';
  const rotationNumber = Number(raw.rotation ?? 0);
  const rotation: DisplayRotation = ROTATIONS.includes(rotationNumber as DisplayRotation)
    ? rotationNumber as DisplayRotation
    : 0;
  const layoutType: LayoutType = LAYOUT_TYPES.includes(raw.layoutType as LayoutType)
    ? raw.layoutType as LayoutType
    : 'grid';
  const playbackMode: PlaybackMode = PLAYBACK_MODES.includes(raw.playbackMode as PlaybackMode)
    ? raw.playbackMode as PlaybackMode
    : 'synchronized-cycle';
  const fitMode: FitMode = FIT_MODES.includes(raw.fitMode as FitMode)
    ? raw.fitMode as FitMode
    : 'contain';
  const fallbackWidth = current?.width ?? (orientation === 'portrait' ? 1080 : 1920);
  const fallbackHeight = current?.height ?? (orientation === 'portrait' ? 1920 : 1080);
  return {
    displayCount: parseIntRange(raw.displayCount, 1, 1, 256),
    width: parseIntRange(raw.width, fallbackWidth, 320, 16384),
    height: parseIntRange(raw.height, fallbackHeight, 320, 16384),
    orientation,
    rotation,
    layoutType,
    columns: raw.columns === undefined || raw.columns === '' ? undefined : parseIntRange(raw.columns, 2, 1, 256),
    rows: raw.rows === undefined || raw.rows === '' ? undefined : parseIntRange(raw.rows, 1, 1, 256),
    gap: Math.min(0.25, Math.max(0, Number(raw.gap ?? 0.01) || 0)),
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId.trim() ? raw.deviceId.trim() : null,
    playlistId: typeof raw.playlistId === 'string' && raw.playlistId.trim() ? raw.playlistId.trim() : null,
    playbackMode,
    dwellMs: parseIntRange(raw.dwellMs, 10_000, 1_000, 3_600_000),
    fitMode,
    resetEpoch: raw.resetEpoch === true,
  };
}
