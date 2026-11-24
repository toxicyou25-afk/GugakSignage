/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { all, get, type DB } from '../db.js';
import type { ContentRow, DeviceRow } from '../types.js';
import { contentDto } from './contents.js';
import { deviceDto } from './devices.js';

export function dashboardRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const contents = all<ContentRow>(db, 'SELECT * FROM contents ORDER BY created_at DESC LIMIT 6');
    const devices = all<DeviceRow>(db, 'SELECT * FROM devices ORDER BY created_at ASC');
    const deviceSummary = devices.map((device) => deviceDto(db, config, device));
    const counts = {
      contents: Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM contents')?.n ?? 0),
      images: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'image'")?.n ?? 0),
      videos: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'video'")?.n ?? 0),
      urls: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contents WHERE kind = 'url'")?.n ?? 0),
      playlists: Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM playlists')?.n ?? 0),
      devices: devices.length,
      onlineDevices: deviceSummary.filter((device) => device.status === 'online').length,
      pendingDevices: deviceSummary.filter((device) => device.status === 'pending').length,
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
      devices: deviceSummary,
      contents: contents.map(contentDto),
      recentPublications,
    });
  });

  return router;
}
