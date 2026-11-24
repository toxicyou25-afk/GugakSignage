// SPDX-License-Identifier: Apache-2.0
import { get, getMeta, run, setMeta, type DB } from './db.js';
import type { DeviceRow, DisplayRow, LayoutRow, SiteRow } from './types.js';
import { engine } from './engine.js';
import { id, nowIso } from './util.js';

interface DevicePlaylistRow {
  id: string;
  name: string;
  playlist_id: string | null;
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
}

function buildDefaultLayout(db: DB, siteId: string, displayCount: number, width: number, height: number): {
  layoutId: string;
  layout: ReturnType<typeof engine.buildLayout>;
} {
  const now = nowIso();
  const layoutId = id();
  const type = displayCount === 1 ? 'single' : 'grid';
  const layout = engine.buildLayout({
    id: layoutId,
    name: displayCount === 1 ? '기본 단일 화면' : `기본 ${displayCount}화면 배치`,
    type,
    displayCount,
    gap: displayCount === 1 ? 0 : 0.01,
    canvasWidth: displayCount === 1 ? width : undefined,
    canvasHeight: displayCount === 1 ? height : undefined,
  });
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
    layout.bezel ?? 0,
    JSON.stringify(layout.slots),
    now,
    now,
  );
  return { layoutId, layout };
}

function ensureDefaultSite(db: DB): { site: SiteRow; groupId: string; layout: LayoutRow } {
  let site = get<SiteRow>(db, 'SELECT * FROM sites ORDER BY created_at, id LIMIT 1');
  const now = nowIso();
  if (!site) {
    const siteId = id();
    run(
      db,
      `INSERT INTO sites(id, name, timezone, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      siteId,
      '기본 장소',
      'Asia/Seoul',
      '기존 MVP 기기에서 자동으로 만든 장소입니다.',
      now,
      now,
    );
    site = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', siteId)!;
  }
  let group = get<{ id: string; layout_id: string }>(
    db,
    'SELECT id, layout_id FROM display_groups WHERE site_id = ? ORDER BY created_at, id LIMIT 1',
    site.id,
  );
  let layout: LayoutRow;
  if (!group) {
    const built = buildDefaultLayout(db, site.id, 1, 1920, 1080);
    const groupId = id();
    run(
      db,
      `INSERT INTO display_groups(id, site_id, name, layout_id, playlist_id, playback_mode,
                                  epoch, dwell_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'synchronized-cycle', ?, 10000, ?, ?)`,
      groupId,
      site.id,
      '기본 화면 그룹',
      built.layoutId,
      now,
      now,
      now,
    );
    group = { id: groupId, layout_id: built.layoutId };
  }
  layout = get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', group.layout_id)!;
  return { site, groupId: group.id, layout };
}

/**
 * Upgrade existing MVP devices in place. Device means the PC/browser pair;
 * each legacy device receives one display and screen assignment. Existing
 * schedules, playlists, and immutable publications stay untouched.
 */
export function migrateLegacyTopology(db: DB): boolean {
  if (getMeta(db, 'topology_schema_version') === '2') return false;
  const devices = db.prepare('SELECT id, name, playlist_id, width, height, orientation, site_id FROM devices ORDER BY created_at, id')
    .all() as unknown as Array<DevicePlaylistRow & { site_id: string | null }>;
  if (devices.length === 0) {
    setMeta(db, 'topology_schema_version', '2');
    return false;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const defaults = ensureDefaultSite(db);
    const now = nowIso();
    for (const device of devices) {
      if (!device.site_id) run(db, 'UPDATE devices SET site_id = ? WHERE id = ?', defaults.site.id, device.id);
      const existing = get<{ id: string }>(db, 'SELECT id FROM displays WHERE device_id = ? LIMIT 1', device.id);
      if (existing) continue;
      run(
        db,
        `INSERT INTO displays(id, site_id, group_id, device_id, playlist_id, name, width, height,
                              orientation, rotation, fit_mode, slot_id, start_index, step, enabled,
                              created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'contain', '', 0, 1, 1, ?, ?)`,
        id(),
        defaults.site.id,
        defaults.groupId,
        device.id,
        device.playlist_id,
        `${device.name} · 화면`,
        device.width,
        device.height,
        device.orientation,
        now,
        now,
      );
    }

    const displays = db.prepare('SELECT * FROM displays WHERE group_id = ? ORDER BY created_at, id')
      .all(defaults.groupId) as unknown as DisplayRow[];
    const layout = engine.buildLayout({
      id: defaults.layout.id,
      name: displays.length <= 1 ? '기본 단일 화면' : `마이그레이션 ${displays.length}화면 배치`,
      type: displays.length <= 1 ? 'single' : 'grid',
      displayCount: Math.max(1, displays.length),
      gap: displays.length <= 1 ? 0 : 0.01,
    });
    run(
      db,
      'UPDATE layouts SET name = ?, type = ?, canvas_width = ?, canvas_height = ?, gap = ?, slots_json = ?, updated_at = ? WHERE id = ?',
      layout.name,
      layout.type,
      layout.canvasWidth,
      layout.canvasHeight,
      layout.gap,
      JSON.stringify(layout.slots),
      now,
      defaults.layout.id,
    );
    displays.forEach((display, index) => {
      run(
        db,
        'UPDATE displays SET slot_id = ?, start_index = ?, updated_at = ? WHERE id = ?',
        layout.slots[index]?.id ?? '',
        index,
        now,
        display.id,
      );
    });
    run(
      db,
      'UPDATE display_groups SET playlist_id = COALESCE(playlist_id, ?), updated_at = ? WHERE id = ?',
      devices[0]?.playlist_id ?? null,
      now,
      defaults.groupId,
    );
    setMeta(db, 'topology_schema_version', '2');
    db.exec('COMMIT;');
    return true;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function ensureDeviceTopology(db: DB, deviceId: string): void {
  const device = get<DevicePlaylistRow & { site_id: string | null }>(
    db,
    'SELECT id, name, playlist_id, width, height, orientation, site_id FROM devices WHERE id = ?',
    deviceId,
  );
  if (!device) return;
  let site: SiteRow | undefined = device.site_id
    ? get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', device.site_id)
    : undefined;
  let groupId: string | undefined;
  if (site) {
    groupId = get<{ id: string }>(
      db,
      'SELECT id FROM display_groups WHERE site_id = ? ORDER BY created_at, id LIMIT 1',
      site.id,
    )?.id;
  }
  if (!site || !groupId) {
    const defaults = ensureDefaultSite(db);
    site = defaults.site;
    groupId = defaults.groupId;
  }
  run(db, 'UPDATE devices SET site_id = ? WHERE id = ?', site.id, deviceId);
  const existing = get<{ id: string }>(db, 'SELECT id FROM displays WHERE device_id = ? ORDER BY created_at, id LIMIT 1', deviceId);
  if (existing) return;
  const group = get<{ layout_id: string }>(db, 'SELECT layout_id FROM display_groups WHERE id = ?', groupId);
  if (!group) return;
  const layoutRow = get<LayoutRow>(db, 'SELECT * FROM layouts WHERE id = ?', group.layout_id);
  if (!layoutRow) return;
  const count = Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM displays WHERE group_id = ?', groupId)?.n ?? 0) + 1;
  const type = layoutRow.type === 'custom' || (layoutRow.type === 'single' && count > 1)
    ? 'grid'
    : count === 1
      ? 'single'
      : layoutRow.type;
  const layout = engine.buildLayout({
    id: layoutRow.id,
    name: layoutRow.name,
    type,
    displayCount: count,
    gap: count === 1 ? 0 : layoutRow.gap,
  });
  const now = nowIso();
  run(
    db,
    'UPDATE layouts SET type = ?, canvas_width = ?, canvas_height = ?, slots_json = ?, updated_at = ? WHERE id = ?',
    layout.type,
    layout.canvasWidth,
    layout.canvasHeight,
    JSON.stringify(layout.slots),
    now,
    layoutRow.id,
  );
  const displays = db.prepare('SELECT id FROM displays WHERE group_id = ? ORDER BY created_at, id')
    .all(groupId) as unknown as Array<{ id: string }>;
  displays.forEach((display, index) => {
    run(db, 'UPDATE displays SET slot_id = ?, start_index = ?, updated_at = ? WHERE id = ?',
      layout.slots[index]?.id ?? '', index, now, display.id);
  });
  const displayId = id();
  run(
    db,
    `INSERT INTO displays(id, site_id, group_id, device_id, playlist_id, name, width, height,
                          orientation, rotation, fit_mode, slot_id, start_index, step, enabled,
                          created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'contain', ?, ?, 1, 1, ?, ?)`,
    displayId,
    site.id,
    groupId,
    deviceId,
    device.playlist_id,
    `${device.name} · 화면`,
    device.width,
    device.height,
    device.orientation,
    layout.slots[count - 1]?.id ?? '',
    count - 1,
    now,
    now,
  );
}
