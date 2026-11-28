/* SPDX-License-Identifier: Apache-2.0 */
export type ContentKind = 'image' | 'video' | 'url';
export type Orientation = 'landscape' | 'portrait';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type DeviceStatus = 'pending' | 'online' | 'offline';
export type PlaybackMode = 'individual' | 'synchronized-cycle' | 'mirror' | 'canvas';
export type LayoutType = 'single' | 'row' | 'column' | 'grid' | 'custom';
export type DisplayRotation = 0 | 90 | 180 | 270;

export interface ContentRow {
  id: string;
  name: string;
  kind: ContentKind;
  mime: string | null;
  stored_name: string | null;
  external_url: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  created_at: string;
}

export interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItemRow {
  id: string;
  playlist_id: string;
  content_id: string;
  position: number;
  duration_seconds: number;
  fit_mode: FitMode;
  fit_mode_override: FitMode | null;
  transition_ms: number;
  enabled: number;
  name: string;
  kind: ContentKind;
  mime: string | null;
  stored_name: string | null;
  external_url: string | null;
  width: number | null;
  height: number | null;
}

export interface DeviceRow {
  id: string;
  name: string;
  location: string | null;
  orientation: Orientation;
  width: number;
  height: number;
  pairing_code: string;
  pairing_code_expires_at: string | null;
  pairing_code_consumed_at: string | null;
  hardware_id: string | null;
  player_token: string | null;
  player_token_hash: string | null;
  playlist_id: string | null;
  published_version: number;
  published_at: string | null;
  last_seen: string | null;
  last_ip: string | null;
  last_host_local: number;
  player_state: string | null;
  last_error: string | null;
  player_version: string | null;
  manifest_version: number | null;
  last_manifest_at: string | null;
  cache_ready: number | null;
  last_heartbeat_at: string | null;
  reconnect_count: number;
  last_reconnect_at: string | null;
  notes: string | null;
  reported_width: number | null;
  reported_height: number | null;
  site_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerMonitorReportRow {
  device_id: string;
  snapshot_json: string;
  reported_at: string;
}

export interface SiteRow {
  id: string;
  name: string;
  timezone: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LayoutRow {
  id: string;
  site_id: string;
  name: string;
  type: LayoutType;
  canvas_width: number;
  canvas_height: number;
  gap: number;
  bezel: number;
  slots_json: string;
  created_at: string;
  updated_at: string;
}

export interface DisplayGroupRow {
  id: string;
  site_id: string;
  name: string;
  layout_id: string;
  playlist_id: string | null;
  playback_mode: PlaybackMode;
  epoch: string;
  dwell_ms: number;
  created_at: string;
  updated_at: string;
}

export interface DisplayRow {
  id: string;
  site_id: string;
  group_id: string;
  device_id: string | null;
  playlist_id: string | null;
  name: string;
  width: number;
  height: number;
  orientation: Orientation;
  rotation: DisplayRotation;
  fit_mode: FitMode;
  slot_id: string;
  start_index: number;
  step: number;
  enabled: number;
  native_monitor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  id: string;
  device_id: string;
  playlist_id: string;
  days: string;
  start_time: string;
  end_time: string;
  enabled: number;
  created_at: string;
}

export interface PlaylistItemInput {
  contentId: string;
  durationSeconds: number;
  fitMode: FitMode | null;
  transitionMs: number;
  enabled: boolean;
}

export interface ScheduleInput {
  playlistId: string;
  days: number[];
  startTime: string;
  endTime: string;
  enabled: boolean;
}

export interface ManifestContent {
  id: string;
  name: string;
  kind: ContentKind;
  mime: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  checksum?: string | null;
}

export interface ManifestItem {
  id: string;
  position: number;
  durationSeconds: number;
  fitMode?: FitMode;
  transitionMs: number;
  enabled: boolean;
  content: ManifestContent;
}

export interface ManifestPlaylist {
  id: string;
  name: string;
  description: string | null;
  items: ManifestItem[];
}

export interface ManifestSchedule {
  id: string;
  days: number[];
  startTime: string;
  endTime: string;
  enabled: boolean;
  playlist: ManifestPlaylist;
}

export interface DeviceManifest {
  version: number;
  publishedAt: string | null;
  defaultPlaylist: ManifestPlaylist | null;
  schedules: ManifestSchedule[];
  device: {
    id: string;
    name: string;
    orientation: Orientation;
    width: number;
    height: number;
  };
  wall?: WallSnapshot;
  serverTime: string;
}

export interface PublicationRow {
  id: string;
  device_id: string;
  version: number;
  snapshot: string;
  published_at: string;
}

export interface WallScreen {
  displayId: string;
  playlistId: string | null;
  playlist: ManifestPlaylist;
}

export interface WallSnapshot {
  schemaVersion: 2;
  publishedAt: string | null;
  site: {
    id: string;
    name: string;
    timezone: string;
    notes: string | null;
  };
  group: {
    id: string;
    siteId: string;
    name: string;
    layoutId: string;
    playlistId: string | null;
    playbackMode: PlaybackMode;
    epoch: string;
    settings: { dwellMs: number; transitionMs: number };
  };
  layout: {
    id: string;
    name: string;
    type: LayoutType;
    canvasWidth: number;
    canvasHeight: number;
    gap: number;
    bezel: number;
    slots: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  };
  displays: Array<{
    id: string;
    deviceId: string | null;
    nativeMonitorId?: string | null;
    groupId: string;
    name: string;
    resolution: { width: number; height: number };
    orientation: Orientation;
    rotation: DisplayRotation;
    fit: FitMode;
    slotId: string;
    startIndex: number;
    step: number;
    status: DeviceStatus | null;
  }>;
  screens: WallScreen[];
  groupPlaylist: ManifestPlaylist | null;
  dwellMs: number;
}
