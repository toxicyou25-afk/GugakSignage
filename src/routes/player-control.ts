/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { all, get, type DB } from '../db.js';
import { readPlayerState, requestPlayerLaunch, requestPlayerStop } from '../player-control.js';
import type { DeviceRow } from '../types.js';

export function playerControlRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ player: { ...readPlayerState(config.dataDir), launchSupported: config.role !== 'manager' } });
  });

  router.post('/launch', (req, res) => {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
    if (!deviceId) {
      res.status(400).json({ error: '재생기를 실행할 기기를 선택해 주세요.' });
      return;
    }
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', deviceId);
    if (!device) {
      res.status(404).json({ error: '기기를 찾을 수 없습니다.' });
      return;
    }
    const assignments = all<{ id: string; native_monitor_id: string | null }>(
      db,
      'SELECT id, native_monitor_id FROM displays WHERE device_id = ? AND enabled = 1 ORDER BY start_index, created_at, id',
      deviceId,
    );
    // A stale heartbeat must not discard saved local monitor bindings on stop/restart.
    const screenTargets = device.last_host_local === 1 && assignments.length > 0 && assignments.every((display) => Boolean(display.native_monitor_id))
      ? assignments.map((display) => ({ displayId: display.id, nativeMonitorId: display.native_monitor_id! }))
      : [];
    const result = requestPlayerLaunch(config, device, screenTargets);
    res.status(202).json({
      ok: true,
      accepted: true,
      commandId: result.command.id,
      playerUrl: result.command.playerUrl,
      screenTargetCount: result.command.screenTargets.length,
      player: result.state,
    });
  });

  router.post('/stop', (_req, res) => {
    if (config.role === 'manager') {
      res.status(403).json({ error: 'Manager 서버에서는 로컬 재생기를 제어할 수 없습니다.' });
      return;
    }
    const result = requestPlayerStop(config);
    res.status(202).json({
      ok: true,
      accepted: true,
      commandId: result.command.id,
      player: result.state,
    });
  });

  return router;
}
