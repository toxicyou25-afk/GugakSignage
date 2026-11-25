/* SPDX-License-Identifier: Apache-2.0 */
import type { FitMode, ManifestContent, ManifestPlaylist, ManifestSchedule } from './types.js';

export type BroadcastSource = 'published' | 'assigned' | 'none';

export interface BroadcastItem {
  id: string;
  contentId: string;
  position: number;
  durationSeconds: number;
  fitMode: FitMode;
  transitionMs: number;
  enabled: boolean;
  playlistId: string;
  playlistName: string;
  content: ManifestContent;
}

export interface CurrentBroadcast {
  playlistId: string | null;
  playlistName: string | null;
  source: BroadcastSource;
  items: BroadcastItem[];
  currentContentId: string | null;
  sampleOnly: boolean;
}

export function emptyBroadcast(): CurrentBroadcast {
  return {
    playlistId: null,
    playlistName: null,
    source: 'none',
    items: [],
    currentContentId: null,
    sampleOnly: false,
  };
}

export function parsePlayingContentId(playerState: string | null | undefined): string | null {
  const value = String(playerState || '').trim();
  if (!value.startsWith('playing:')) return null;
  const contentId = value.slice('playing:'.length).trim();
  return contentId || null;
}

function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Mirrors the player's local-time schedule selection for the published snapshot. */
export function activePlaylistForNow(
  defaultPlaylist: ManifestPlaylist | null,
  schedules: ManifestSchedule[] | null | undefined,
  now: Date = new Date(),
): ManifestPlaylist | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  for (const schedule of schedules || []) {
    if (!schedule.enabled || !Array.isArray(schedule.days)) continue;
    const start = parseTime(schedule.startTime);
    const end = parseTime(schedule.endTime);
    if (start < 0 || end < 0) continue;
    let applies = false;
    if (start <= end) {
      applies = schedule.days.includes(day) && minutes >= start && minutes < end;
    } else if (minutes >= start) {
      applies = schedule.days.includes(day);
    } else if (minutes < end) {
      applies = schedule.days.includes((day + 6) % 7);
    }
    if (applies) return schedule.playlist;
  }
  return defaultPlaylist;
}

export function broadcastFromPlaylist(playlist: ManifestPlaylist, source: Exclude<BroadcastSource, 'none'>): CurrentBroadcast {
  const items = (playlist.items || [])
    .filter((item) => item.enabled && item.content)
    .map((item) => ({
      id: item.id,
      contentId: item.content.id,
      position: item.position,
      durationSeconds: item.durationSeconds,
      fitMode: item.fitMode || 'contain',
      transitionMs: item.transitionMs,
      enabled: item.enabled,
      playlistId: playlist.id,
      playlistName: playlist.name,
      content: item.content,
    }));
  return {
    playlistId: playlist.id,
    playlistName: playlist.name,
    source,
    items,
    currentContentId: null,
    sampleOnly: isSampleOnly(items),
  };
}

export function mergeBroadcasts(
  playlists: ManifestPlaylist[],
  source: Exclude<BroadcastSource, 'none'>,
): CurrentBroadcast {
  const items = playlists.flatMap((playlist) => broadcastFromPlaylist(playlist, source).items);
  return {
    playlistId: playlists.length === 1 ? playlists[0]!.id : null,
    playlistName: playlists.length ? [...new Set(playlists.map((playlist) => playlist.name))].join(' · ') : null,
    source,
    items,
    currentContentId: null,
    sampleOnly: isSampleOnly(items),
  };
}

export function isSampleContentId(contentId: string | null | undefined): boolean {
  return String(contentId || '').startsWith('ct-sample-');
}

export function isSampleOnly(items: Array<{ contentId: string }>): boolean {
  return items.length > 0 && items.every((item) => isSampleContentId(item.contentId));
}

interface SnapshotLike {
  defaultPlaylist?: ManifestPlaylist | null;
  schedules?: Array<{ playlist: ManifestPlaylist }> | null;
  wall?: {
    groupPlaylist?: ManifestPlaylist | null;
    screens?: Array<{ playlist: ManifestPlaylist }> | null;
  } | null;
}

/** Whether any published playlist contains content uploaded by the operator. */
export function snapshotHasUserContent(snapshot: SnapshotLike | null | undefined): boolean {
  if (!snapshot) return false;
  const playlists: ManifestPlaylist[] = [];
  if (snapshot.defaultPlaylist) playlists.push(snapshot.defaultPlaylist);
  for (const schedule of snapshot.schedules || []) playlists.push(schedule.playlist);
  if (snapshot.wall?.groupPlaylist) playlists.push(snapshot.wall.groupPlaylist);
  for (const screen of snapshot.wall?.screens || []) playlists.push(screen.playlist);
  return playlists.some((playlist) =>
    (playlist.items || []).some((item) => !isSampleContentId(item.content?.id)),
  );
}

/** The exact banner condition used by the dashboard API. */
export function shouldShowSampleBanner({
  hasUserContents = false,
  hasUserPublication = false,
}: {
  hasUserContents?: boolean;
  hasUserPublication?: boolean;
} = {}): boolean {
  return !hasUserContents || !hasUserPublication;
}
