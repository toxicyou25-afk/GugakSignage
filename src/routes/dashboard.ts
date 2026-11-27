/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { all, get, type DB } from '../db.js';
import {
  activePlaylistForNow,
  broadcastFromPlaylist,
  emptyBroadcast,
  mergeBroadcasts,
  parsePlayingContentId,
  shouldShowSampleBanner,
  snapshotHasUserContent,
  type BroadcastItem,
  type CurrentBroadcast,
} from '../current-display.js';
import { buildPlaylist, latestPublication, type Snapshot } from '../publishing.js';
import { playerHealth, summarizePlayerHealth } from '../player-health.js';
import { readPlayerState, type PlayerControlState } from '../player-control.js';
import type { ContentRow, DeviceRow } from '../types.js';
import { safeJsonParse } from '../util.js';
import { contentDto } from './contents.js';
import { deviceDto } from './devices.js';

type DashboardDevice = ReturnType<typeof deviceDto> & { broadcast: CurrentBroadcast };

function broadcastItemsForDevice(
  db: DB,
  device: DeviceRow,
  now: Date,
): CurrentBroadcast {
  const publication = latestPublication(db, device.id);
  if (publication) {
    const snapshot = safeJsonParse<Snapshot>(publication.snapshot);
    if (snapshot?.wall) {
      const playlists = (snapshot.wall.screens || [])
        .map((screen) => screen.playlist)
        .filter((playlist, index, values) => values.findIndex((value) => value.id === playlist.id) === index);
      if (playlists.length > 0) {
        const merged = mergeBroadcasts(playlists, 'published');
        merged.playlistId = snapshot.wall.group.id;
        return merged;
      }
      if (snapshot.wall.groupPlaylist) {
        const merged = broadcastFromPlaylist(snapshot.wall.groupPlaylist, 'published');
        merged.playlistId = snapshot.wall.group.id;
        return merged;
      }
    }
    const active = activePlaylistForNow(
      snapshot?.defaultPlaylist ?? null,
      snapshot?.schedules ?? [],
      now,
    );
    if (active) return broadcastFromPlaylist(active, 'published');
    return {
      ...emptyBroadcast(),
      source: 'published',
    };
  }

  if (device.playlist_id) {
    const assigned = buildPlaylist(db, device.playlist_id);
    if (assigned) return broadcastFromPlaylist(assigned, 'assigned');
  }
  return emptyBroadcast();
}

function withCurrentContent(
  broadcast: CurrentBroadcast,
  playerState: string | null,
  playerControl: PlayerControlState,
  deviceId: string,
): CurrentBroadcast {
  const currentContentId = playerControl.running && playerControl.deviceId === deviceId
    ? parsePlayingContentId(playerState)
    : null;
  if (!currentContentId) return broadcast;
  const visible = broadcast.items.some((item: BroadcastItem) => item.contentId === currentContentId);
  return {
    ...broadcast,
    currentContentId: visible ? currentContentId : null,
  };
}

function publishedContainsUserContent(db: DB, deviceId: string): boolean {
  const publication = latestPublication(db, deviceId);
  if (!publication) return false;
  return snapshotHasUserContent(safeJsonParse<Snapshot>(publication.snapshot));
}

export function dashboardRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const contents = all<ContentRow>(db, 'SELECT * FROM contents ORDER BY created_at DESC LIMIT 6');
    const devices = all<DeviceRow>(db, 'SELECT * FROM devices ORDER BY created_at ASC');
    const healthNow = Date.now();
    const health = summarizePlayerHealth(devices.map((device) => playerHealth(device, config.heartbeatOnlineMs, healthNow)));
    const now = new Date();
    const playerControl = { ...readPlayerState(config.dataDir), launchSupported: config.role !== 'manager' };
    const deviceSummary: DashboardDevice[] = devices.map((device) => {
      const summary = deviceDto(db, config, device);
      const broadcast = withCurrentContent(
        broadcastItemsForDevice(db, device, now),
        device.player_state,
        playerControl,
        device.id,
      );
      return { ...summary, broadcast };
    });
    const hasUserContents = Number(get<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM contents WHERE id NOT LIKE 'ct-sample-%'",
    )?.n ?? 0) > 0;
    const hasUserPublication = devices.some((device) => publishedContainsUserContent(db, device.id));
    const counts = {
      contents: Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM contents')?.n ?? 0),
      images: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'image'")?.n ?? 0),
      videos: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'video'")?.n ?? 0),
      urls: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'url'")?.n ?? 0),
      playlists: Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM playlists')?.n ?? 0),
      devices: devices.length,
      onlineDevices: deviceSummary.filter((device) => device.status === 'online').length,
      healthyDevices: health.online,
      offlineDevices: health.offline,
      pendingDevices: health.pending,
      degradedDevices: health.degraded,
      staleDevices: health.stale,
      behindDevices: health.behind,
      attentionDevices: health.attention,
      reconnectedDevices: deviceSummary.filter((device) => device.reconnectCount > 0).length,
      publishedDevices: devices.filter((device) => device.published_version > 0).length,
    };
    const recentPublications = all<{
      id: string;
      version: number;
      published_at: string;
      device_name: string;
    }>(
      db,
      `SELECT p.id, p.version, p.published_at, d.name AS device_name
         FROM publications p
         JOIN devices d ON d.id = p.device_id
        ORDER BY p.published_at DESC
        LIMIT 5`,
    );
    res.json({
      counts,
      health,
      devices: deviceSummary,
      contents: contents.map(contentDto),
      recentPublications,
      playerControl,
      sampleContent: {
        showBanner: shouldShowSampleBanner({ hasUserContents, hasUserPublication }),
        hasUserContents,
        hasUserPublication,
      },
    });
  });

  return router;
}
