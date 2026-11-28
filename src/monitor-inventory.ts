// SPDX-License-Identifier: Apache-2.0
import { all, get, type DB } from './db.js';
import type { NativeMonitor } from './native-monitors.js';
import type { DeviceRow } from './types.js';
import { deviceStatus, nowIso, safeJsonParse } from './util.js';

export interface SiteMonitorAssignment {
  displayId: string;
  displayName: string;
  groupId: string;
  groupName: string;
  playlistId: string | null;
  playlistName: string | null;
  nativeMonitorId: string | null;
  monitorDetected: boolean;
}

export interface SiteMonitorDevice {
  deviceId: string;
  name: string;
  siteAssigned: boolean;
  localHost: boolean;
  status: ReturnType<typeof deviceStatus>;
  online: boolean;
  lastSeen: string | null;
  publishedVersion: number;
  monitorReport: {
    reported: boolean;
    reportedAt: string | null;
    ageMs: number | null;
    monitors: NativeMonitor[];
  };
  assignments: SiteMonitorAssignment[];
  logicalDisplayCount: number;
  assignedDisplayCount: number;
  unassignedDisplayIds: string[];
}

export interface SiteMonitorInventory {
  siteId: string;
  generatedAt: string;
  devices: SiteMonitorDevice[];
}

interface AssignmentRow {
  display_id: string;
  display_name: string;
  group_id: string;
  group_name: string;
  playlist_id: string | null;
  playlist_name: string | null;
  native_monitor_id: string | null;
}

interface ReportRow {
  snapshot_json: string;
  reported_at: string;
}

export function monitorInventoryForSite(
  db: DB,
  siteId: string,
  heartbeatOnlineMs: number,
): SiteMonitorInventory | null {
  if (!get<{ id: string }>(db, 'SELECT id FROM sites WHERE id = ?', siteId)) return null;

  const generatedAt = nowIso();
  const generatedAtMs = Date.parse(generatedAt);
  const devices = all<DeviceRow>(
    db,
    `SELECT * FROM devices
      WHERE site_id = ?
         OR (site_id IS NULL AND NOT EXISTS (
           SELECT 1 FROM displays assigned WHERE assigned.device_id = devices.id
         ))
      ORDER BY name, id`,
    siteId,
  );

  return {
    siteId,
    generatedAt,
    devices: devices.map((device) => {
      const report = get<ReportRow>(
        db,
        'SELECT snapshot_json, reported_at FROM player_monitor_reports WHERE device_id = ?',
        device.id,
      );
      const monitors = report ? safeJsonParse<NativeMonitor[]>(report.snapshot_json) ?? [] : [];
      const reportedAtMs = report ? Date.parse(report.reported_at) : Number.NaN;
      const assignments = all<AssignmentRow>(
        db,
        `SELECT d.id AS display_id, d.name AS display_name, d.group_id, g.name AS group_name,
                d.playlist_id, p.name AS playlist_name, d.native_monitor_id
         FROM displays d
         JOIN display_groups g ON g.id = d.group_id
         LEFT JOIN playlists p ON p.id = d.playlist_id
         WHERE d.site_id = ? AND d.device_id = ? AND d.enabled = 1
         ORDER BY d.start_index, d.created_at, d.rowid`,
        siteId,
        device.id,
      ).map((assignment) => ({
        displayId: assignment.display_id,
        displayName: assignment.display_name,
        groupId: assignment.group_id,
        groupName: assignment.group_name,
        playlistId: assignment.playlist_id,
        playlistName: assignment.playlist_name,
        nativeMonitorId: assignment.native_monitor_id,
        monitorDetected: assignment.native_monitor_id !== null && monitors.some(
          (monitor) => monitor.bindingId === assignment.native_monitor_id,
        ),
      }));
      const lastSeenMs = device.last_seen ? Date.parse(device.last_seen) : Number.NaN;
      const heartbeatAgeMs = generatedAtMs - lastSeenMs;
      const status = deviceStatus(device, heartbeatOnlineMs);
      const online = status === 'online';

      return {
        deviceId: device.id,
        name: device.name,
        siteAssigned: device.site_id === siteId,
        localHost: device.last_host_local === 1 && Number.isFinite(lastSeenMs) &&
          heartbeatAgeMs >= 0 && heartbeatAgeMs <= heartbeatOnlineMs,
        status,
        online,
        lastSeen: device.last_seen,
        publishedVersion: device.published_version,
        monitorReport: {
          reported: report !== undefined,
          reportedAt: report?.reported_at ?? null,
          ageMs: report && Number.isFinite(reportedAtMs) ? Math.max(0, generatedAtMs - reportedAtMs) : null,
          monitors,
        },
        assignments,
        logicalDisplayCount: assignments.length,
        assignedDisplayCount: assignments.filter((assignment) => assignment.nativeMonitorId !== null).length,
        unassignedDisplayIds: assignments.filter((assignment) => assignment.nativeMonitorId === null)
          .map((assignment) => assignment.displayId),
      };
    }),
  };
}
