/* SPDX-License-Identifier: Apache-2.0 */
import { Router, type Request } from 'express';
import type { AppConfig } from '../config.js';
import { get, run, type DB } from '../db.js';
import { manifestForDevice } from '../publishing.js';
import type { DeviceRow } from '../types.js';
import { asTrimmed, clientIp, newPlayerToken, normalizePairingCode, nowIso, parseIntRange } from '../util.js';

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
  run(
    db,
    'UPDATE devices SET last_seen = ?, last_ip = ? WHERE id = ?',
    nowIso(),
    clientIp(req),
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
    run(
      db,
      `UPDATE devices SET hardware_id = ?, player_token = ?, last_seen = ?, last_ip = ?, player_state = 'connected',
             last_error = NULL, reported_width = ?, reported_height = ?, updated_at = ?
        WHERE id = ?`,
      hardwareId,
      token,
      now,
      clientIp(req),
      reportedWidth,
      reportedHeight,
      now,
      device.id,
    );
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
    const stateWithContent = currentContentId ? `${state}:${currentContentId}`.slice(0, 160) : state;
    run(
      db,
      'UPDATE devices SET last_seen = ?, last_ip = ?, player_state = ?, last_error = ? WHERE id = ?',
      nowIso(),
      clientIp(req),
      stateWithContent,
      error,
      device.id,
    );
    res.json({ ok: true, publishedVersion: device.published_version, serverTime: nowIso() });
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
      demoDefaultPassword: Boolean(sample) && config.adminPassword === 'gugak1234',
    });
  });

  return router;
}
