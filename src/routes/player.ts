/* SPDX-License-Identifier: Apache-2.0 */
import { Router, type Request } from 'express';
import type { AppConfig } from '../config.js';
import { get, run, transaction, type DB } from '../db.js';
import { isDirectLoopbackRequest } from '../admin-access.js';
import { manifestForDevice } from '../publishing.js';
import { usesTestDefaultAdminPassword } from '../admin-password.js';
import type { DeviceRow } from '../types.js';
import {
  asTrimmed,
  clientIp,
  newPlayerToken,
  normalizePairingCode,
  nowIso,
  optionalBool,
  optionalInt,
  parseIntRange,
} from '../util.js';

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function playerDevice(db: DB, req: Request): DeviceRow | undefined {
  const token = bearerToken(req);
  if (!token) return undefined;
  return get<DeviceRow>(db, 'SELECT * FROM devices WHERE player_token = ?', token);
}

function touch(db: DB, req: Request, device: DeviceRow): void {
  const now = nowIso();
  run(
    db,
    `UPDATE devices SET last_seen = ?, last_ip = ?, last_host_local = ?, last_manifest_at = ?
      WHERE id = ?`,
    now,
    clientIp(req),
    Number(isDirectLoopbackRequest(req)),
    now,
    device.id,
  );
}

function playerView(device: DeviceRow) {
  return {
    id: device.id,
    name: device.name,
    orientation: device.orientation,
    width: device.width,
    height: device.height,
    publishedVersion: device.published_version,
  };
}

export function playerRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.post('/register', (req, res) => {
    const code = normalizePairingCode(req.body?.code);
    const hardwareId = asTrimmed(req.body?.hardwareId, 200);
    if (!code) {
      res.status(400).json({ error: '등록 코드를 입력해 주세요.' });
      return;
    }
    if (!hardwareId || hardwareId.length < 8) {
      res.status(400).json({ error: '재생기 식별자를 만들지 못했습니다. 브라우저 저장 공간을 확인해 주세요.' });
      return;
    }
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE pairing_code = ?', code);
    if (!device) {
      const sample = get<DeviceRow>(db, "SELECT * FROM devices WHERE id = 'dev-sample-lobby'");
      res.status(404).json({
        error: '등록 코드를 찾을 수 없습니다. 관리 화면 → 기기 카드에서 6자리 코드를 확인해 주세요.',
        sampleCode: sample?.pairing_code ?? null,
      });
      return;
    }
    if (device.hardware_id && device.hardware_id !== hardwareId) {
      if (req.body?.takeover !== true) {
        res.status(409).json({
          error: '이미 다른 재생기가 연결된 기기입니다. 기존 연결을 끊고 다시 연결하면 이 화면으로 바꿀 수 있습니다.',
        });
        return;
      }
    }
    const token = device.hardware_id && device.hardware_id !== hardwareId
      ? newPlayerToken()
      : device.player_token || newPlayerToken();
    const screen = req.body?.screen && typeof req.body.screen === 'object' ? req.body.screen : {};
    const reportedWidth = parseIntRange((screen as Record<string, unknown>).width, 0, 0, 16384) || null;
    const reportedHeight = parseIntRange((screen as Record<string, unknown>).height, 0, 0, 16384) || null;
    const now = nowIso();
    const directLocalHost = isDirectLoopbackRequest(req);
    transaction(db, () => {
      run(
        db,
        `UPDATE devices SET hardware_id = ?, player_token = ?, last_seen = ?, last_ip = ?, last_host_local = ?, player_state = 'connected',
             last_heartbeat_at = NULL, manifest_version = NULL, last_manifest_at = NULL, cache_ready = NULL,
             player_version = NULL, last_reconnect_at = NULL,
             last_error = NULL, reported_width = ?, reported_height = ?, updated_at = ?
          WHERE id = ?`,
        hardwareId,
        token,
        now,
        clientIp(req),
        Number(directLocalHost),
        reportedWidth,
        reportedHeight,
        now,
        device.id,
      );
      if (!directLocalHost) {
        run(db, 'UPDATE displays SET native_monitor_id = NULL WHERE device_id = ?', device.id);
      }
    });
    const updated = get<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', device.id);
    res.json({ token, device: updated ? playerView(updated) : playerView(device) });
  });

  router.get('/manifest', (req, res) => {
    const device = playerDevice(db, req);
    if (!device) {
      res.status(401).json({ error: '재생기 연결이 만료되었습니다. 등록 코드로 다시 연결해 주세요.' });
      return;
    }
    touch(db, req, device);
    res.json({ manifest: manifestForDevice(db, device), serverTime: nowIso() });
  });

  router.post('/heartbeat', (req, res) => {
    const device = playerDevice(db, req);
    if (!device) {
      res.status(401).json({ error: '재생기 연결이 만료되었습니다.' });
      return;
    }
    const state = asTrimmed(req.body?.state, 60) || 'playing';
    const currentContentId = asTrimmed(req.body?.currentContentId, 100) || null;
    const error = asTrimmed(req.body?.error, 1000) || null;
    const playerVersion = asTrimmed(req.body?.playerVersion, 60) || null;
    const manifestVersion = optionalInt(req.body?.manifestVersion, 0, 1_000_000);
    const cacheReady = optionalBool(req.body?.cacheReady);
    const stateWithContent = currentContentId ? `${state}:${currentContentId}`.slice(0, 160) : state;
    const now = nowIso();
    // A heartbeat after the online threshold means this player recovered from a
    // network/restart outage. Count the transition once per outage, not per beat.
    const previouslyOffline = !device.last_seen || (() => {
      const seen = Date.parse(device.last_seen);
      return !Number.isFinite(seen) || Date.parse(now) - seen > config.heartbeatOnlineMs;
    })();
    const previousHeartbeat = device.last_heartbeat_at ? Date.parse(device.last_heartbeat_at) : Number.NaN;
    const heartbeatWasStale = Number.isFinite(previousHeartbeat) && Date.parse(now) - previousHeartbeat > config.heartbeatOnlineMs;
    const reconnected = Boolean(device.hardware_id) && (previouslyOffline || heartbeatWasStale);
    const reconnectCount = device.reconnect_count + (reconnected ? 1 : 0);
    run(
      db,
      `UPDATE devices SET last_seen = ?, last_ip = ?, last_host_local = ?, player_state = ?, last_error = ?,
             player_version = COALESCE(?, player_version),
             manifest_version = COALESCE(?, manifest_version),
             cache_ready = COALESCE(?, cache_ready),
             last_heartbeat_at = ?,
             reconnect_count = ?,
             last_reconnect_at = COALESCE(?, last_reconnect_at)
        WHERE id = ?`,
      now,
      clientIp(req),
      Number(isDirectLoopbackRequest(req)),
      stateWithContent,
      error,
      playerVersion,
      manifestVersion,
      cacheReady,
      now,
      reconnectCount,
      reconnected ? now : device.last_reconnect_at,
      device.id,
    );
    res.json({
      ok: true,
      publishedVersion: device.published_version,
      serverTime: now,
      reconnected,
      reconnectCount,
    });
  });

  router.get('/config', (_req, res) => {
    const sample = get<DeviceRow>(db, "SELECT * FROM devices WHERE id = 'dev-sample-lobby'");
    res.json({
      pollSeconds: 15,
      heartbeatSeconds: 15,
      name: '국악원 사이니지 재생기',
      adminDevicesUrl: '/admin/#/devices',
      sampleMode: Boolean(sample),
      sampleCode: sample?.pairing_code ?? null,
      sampleDeviceName: sample?.name ?? null,
      demoDefaultPassword: usesTestDefaultAdminPassword(db),
    });
  });

  return router;
}
