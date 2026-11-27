/* SPDX-License-Identifier: Apache-2.0 */
import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import { all, get, run, transaction, type DB } from '../db.js';
import { isDirectLoopbackRequest } from '../admin-access.js';
import { manifestForDevice } from '../publishing.js';
import { usesTestDefaultAdminPassword } from '../admin-password.js';
import type { NativeMonitor } from '../native-monitors.js';
import type { DeviceRow } from '../types.js';
import {
  asTrimmed,
  clientIp,
  hashPlayerToken,
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
  return get<DeviceRow>(db, 'SELECT * FROM devices WHERE player_token_hash = ? AND hardware_id IS NOT NULL', hashPlayerToken(token));
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

  router.put('/native-monitors', (req, res) => {
    const device = playerDevice(db, req);
    if (!device) { res.status(401).json({ error: '재생기 연결이 만료되었습니다.' }); return; }
    const input = req.body?.monitors;
    const validId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512 && /^MONITOR\\/iu.test(value);
    if (!Array.isArray(input) || input.length > 32) { res.status(400).json({ error: '모니터 정보는 최대 32개까지 보고할 수 있습니다.' }); return; }
    const monitors: NativeMonitor[] = [];
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') { res.status(400).json({ error: '모니터 정보 형식이 올바르지 않습니다.' }); return; }
      const m = raw as Record<string, unknown>;
      const bounds = m.bounds as Record<string, unknown> | null;
      const dims = bounds && ['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isSafeInteger(bounds[key]));
      if (typeof m.stableId !== 'string' || !m.stableId.trim() || m.stableId.length > 512 ||
          (m.bindingId !== null && !validId(m.bindingId)) ||
          typeof m.deviceName !== 'string' || !m.deviceName.trim() || m.deviceName.length > 128 ||
          typeof m.friendlyName !== 'string' || m.friendlyName.length > 256 || !bounds || !dims ||
          (bounds.width as number) <= 0 || (bounds.height as number) <= 0 || Math.abs(bounds.x as number) > 1_000_000 || Math.abs(bounds.y as number) > 1_000_000 ||
          (bounds.width as number) > 32768 || (bounds.height as number) > 32768 ||
          !['landscape', 'portrait'].includes(String(m.orientation)) || typeof m.primary !== 'boolean' || typeof m.attached !== 'boolean') {
        res.status(400).json({ error: '모니터 ID, 화면 경계 또는 방향이 올바르지 않습니다.' }); return;
      }
      monitors.push({ stableId: m.stableId.trim(), bindingId: typeof m.bindingId === 'string' ? m.bindingId : null, deviceName: m.deviceName.trim(), friendlyName: (m.friendlyName as string).trim(),
        bounds: { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number },
        resolution: { width: bounds.width as number, height: bounds.height as number }, orientation: m.orientation as NativeMonitor['orientation'], primary: m.primary, attached: m.attached });
    }
    const bindingIds = monitors.map((m) => m.bindingId).filter((bindingId): bindingId is string => Boolean(bindingId));
    if (new Set(monitors.map((m) => m.stableId)).size !== monitors.length || new Set(bindingIds).size !== bindingIds.length) {
      res.status(400).json({ error: '모니터 ID는 서로 달라야 합니다.' }); return;
    }
    const reportedAt = nowIso();
    run(db, `INSERT INTO player_monitor_reports(device_id, snapshot_json, reported_at) VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, reported_at = excluded.reported_at`, device.id, JSON.stringify(monitors), reportedAt);
    res.json({ ok: true, reportedAt });
  });

  router.get('/screen-targets', (req, res) => {
    const device = playerDevice(db, req);
    if (!device) { res.status(401).json({ error: '재생기 연결이 만료되었습니다.' }); return; }
    touch(db, req, device);
    const screenTargets = all<{ displayId: string; nativeMonitorId: string }>(db,
      `SELECT id AS displayId, native_monitor_id AS nativeMonitorId FROM displays
        WHERE device_id = ? AND native_monitor_id IS NOT NULL ORDER BY start_index, rowid`, device.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ deviceId: device.id, screenTargets });
  });

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
    const networkMode = config.mode !== 'standalone';
    const attemptKey = networkMode
      ? crypto.createHmac('sha256', config.sessionSecret).update(clientIp(req), 'utf8').digest('hex')
      : '';
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    if (networkMode) {
      const attempt = get<{ blocked_until: string | null }>(db,
        'SELECT blocked_until FROM player_pairing_attempts WHERE client_key_hash = ?', attemptKey);
      if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > nowMs) {
        res.status(429).json({ error: '등록 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
        return;
      }
    }
    const failedCode = (): void => {
      if (networkMode) {
        const current = get<{ failed_count: number; window_started_at: string }>(db,
          'SELECT failed_count, window_started_at FROM player_pairing_attempts WHERE client_key_hash = ?', attemptKey);
        const windowValid = current && nowMs - Date.parse(current.window_started_at) < 10 * 60_000;
        const failedCount = windowValid ? current.failed_count + 1 : 1;
        const windowStartedAt = windowValid ? current.window_started_at : now;
        const blockedUntil = failedCount >= 5 ? new Date(nowMs + 10 * 60_000).toISOString() : null;
        run(db, `INSERT INTO player_pairing_attempts(client_key_hash, failed_count, window_started_at, blocked_until)
          VALUES (?, ?, ?, ?) ON CONFLICT(client_key_hash) DO UPDATE SET
          failed_count = excluded.failed_count, window_started_at = excluded.window_started_at,
          blocked_until = excluded.blocked_until`, attemptKey, failedCount, windowStartedAt, blockedUntil);
      }
      if (networkMode) res.status(404).json({ error: '등록 코드를 찾을 수 없거나 만료되었습니다.' });
      else {
        const sample = get<DeviceRow>(db, "SELECT * FROM devices WHERE id = 'dev-sample-lobby'");
        res.status(404).json({
          error: '등록 코드를 찾을 수 없습니다. 관리 화면 → 기기 카드에서 6자리 코드를 확인해 주세요.',
          sampleCode: sample?.pairing_code ?? null,
        });
      }
    };
    const device = get<DeviceRow>(db, 'SELECT * FROM devices WHERE pairing_code = ?', code);
    const requestedPlayerToken = req.body?.playerToken === undefined ? null : asTrimmed(req.body.playerToken, 64);
    if (req.body?.playerToken !== undefined && (!requestedPlayerToken || !/^[a-f0-9]{64}$/.test(requestedPlayerToken))) {
      res.status(400).json({ error: '재생기 인증 정보를 확인해 주세요.' });
      return;
    }
    if (networkMode && device?.pairing_code_consumed_at !== null && device?.pairing_code_consumed_at !== undefined &&
        requestedPlayerToken && device.hardware_id === hardwareId && device.player_token_hash === hashPlayerToken(requestedPlayerToken)) {
      res.json({ token: requestedPlayerToken, device: playerView(device) });
      return;
    }
    if (!device || (networkMode && (device.pairing_code_consumed_at !== null || !device.pairing_code_expires_at || Date.parse(device.pairing_code_expires_at) <= nowMs))) {
      failedCode();
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
    const token = requestedPlayerToken ?? newPlayerToken();
    const tokenHash = hashPlayerToken(token);
    const screen = req.body?.screen && typeof req.body.screen === 'object' ? req.body.screen : {};
    const reportedWidth = parseIntRange((screen as Record<string, unknown>).width, 0, 0, 16384) || null;
    const reportedHeight = parseIntRange((screen as Record<string, unknown>).height, 0, 0, 16384) || null;
    const directLocalHost = isDirectLoopbackRequest(req);
    let registrationCommitted = true;
    transaction(db, () => {
      const result = run(
        db,
        `UPDATE devices SET hardware_id = ?, player_token = NULL, player_token_hash = ?, last_seen = ?, last_ip = ?, last_host_local = ?, player_state = 'connected',
             pairing_code_consumed_at = CASE WHEN ? THEN ? ELSE pairing_code_consumed_at END,
             last_heartbeat_at = NULL, manifest_version = NULL, last_manifest_at = NULL, cache_ready = NULL,
             player_version = NULL, last_reconnect_at = NULL,
             last_error = NULL, reported_width = ?, reported_height = ?, updated_at = ?
          WHERE id = ? AND pairing_code = ?
            AND (? = 0 OR (pairing_code_consumed_at IS NULL AND pairing_code_expires_at IS NOT NULL AND pairing_code_expires_at > ?))`,
        hardwareId,
        tokenHash,
        now,
        clientIp(req),
        Number(directLocalHost),
        Number(networkMode),
        now,
        reportedWidth,
        reportedHeight,
        now,
        device.id,
        code,
        Number(networkMode),
        now,
      );
      if (result.changes !== 1) { registrationCommitted = false; return; }
      if (!directLocalHost) {
        run(db, 'UPDATE displays SET native_monitor_id = NULL WHERE device_id = ?', device.id);
      }
      if (networkMode) run(db, 'DELETE FROM player_pairing_attempts WHERE client_key_hash = ?', attemptKey);
    });
    if (!registrationCommitted) { failedCode(); return; }
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
    const standalone = config.mode === 'standalone';
    res.json({
      pollSeconds: 15,
      heartbeatSeconds: 15,
      name: '국악원 사이니지 재생기',
      adminDevicesUrl: '/admin/#/devices',
      sampleMode: standalone && Boolean(sample),
      sampleCode: standalone ? sample?.pairing_code ?? null : null,
      sampleDeviceName: standalone ? sample?.name ?? null : null,
      demoDefaultPassword: usesTestDefaultAdminPassword(db),
    });
  });

  return router;
}
