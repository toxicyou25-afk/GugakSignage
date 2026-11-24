/* SPDX-License-Identifier: Apache-2.0 */
export type ContentKind = 'image' | 'video' | 'url';
export type Orientation = 'landscape' | 'portrait';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type DeviceStatus = 'pending' | 'online' | 'offline';

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
  hardware_id: string | null;
  player_token: string | null;
  playlist_id: string | null;
  published_version: number;
  published_at: string | null;
  last_seen: string | null;
  last_ip: string | null;
  player_state: string | null;
  last_error: string | null;
  notes: string | null;
  reported_width: number | null;
  reported_height: number | null;
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
  fitMode: FitMode;
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
}

export interface ManifestItem {
  id: string;
  position: number;
  durationSeconds: number;
  fitMode: FitMode;
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
  serverTime: string;
}

export interface PublicationRow {
  id: string;
  device_id: string;
  version: number;
  snapshot: string;
  published_at: string;
}
