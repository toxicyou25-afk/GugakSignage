// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { get, run, type DB } from '../db.js';
import { publishGroupSnapshot } from '../publishing.js';
import {
  buildWallSnapshot,
  configureGroupDisplays,
  createDisplayGroup,
  createSite,
  parseGroupConfiguration,
  previewWall,
  siteDetail,
  siteSummary,
  updateDisplay,
} from '../topology.js';
import type {
  DisplayGroupRow,
  DisplayRotation,
  FitMode,
  Orientation,
  PlaybackMode,
  SiteRow,
} from '../types.js';
import { asTrimmed, nowIso } from '../util.js';

function requireGroup(db: DB, id: string): DisplayGroupRow {
  const group = get<DisplayGroupRow>(db, 'SELECT * FROM display_groups WHERE id = ?', id);
  if (!group) throw new Error('화면 그룹을 찾을 수 없습니다.');
  return group;
}

function playlistExists(db: DB, playlistId: unknown): string | null {
  const value = asTrimmed(playlistId, 100);
  if (!value) return null;
  if (!get<{ id: string }>(db, 'SELECT id FROM playlists WHERE id = ?', value)) {
    throw new Error('선택한 재생목록을 찾을 수 없습니다.');
  }
  return value;
}

export function topologyRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/sites', (_req, res) => {
    res.json(siteSummary(db));
  });

  router.post('/sites', (req, res) => {
    const name = asTrimmed(req.body?.name, 120);
    if (!name) throw new Error('장소 이름을 입력해 주세요.');
    const timezone = asTrimmed(req.body?.timezone, 80) || 'Asia/Seoul';
    if (!/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(timezone)) {
      throw new Error('시간대는 Asia/Seoul 같은 IANA 형식으로 입력해 주세요.');
    }
    const notes = asTrimmed(req.body?.notes, 1000) || null;
    const result = createSite(db, { name, timezone, notes });
    res.status(201).json({ site: result.site, group: result.group });
  });

  router.get('/sites/:id', (req, res) => {
    const detail = siteDetail(db, req.params.id, config.heartbeatOnlineMs);
    if (!detail) {
      res.status(404).json({ error: '장소를 찾을 수 없습니다.' });
      return;
    }
    res.json(detail);
  });

  router.put('/sites/:id', (req, res) => {
    const site = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', req.params.id);
    if (!site) {
      res.status(404).json({ error: '장소를 찾을 수 없습니다.' });
      return;
    }
    const name = asTrimmed(req.body?.name, 120) || site.name;
    const timezone = asTrimmed(req.body?.timezone, 80) || site.timezone;
    const notes = req.body?.notes === undefined ? site.notes : asTrimmed(req.body.notes, 1000) || null;
    run(
      db,
      'UPDATE sites SET name = ?, timezone = ?, notes = ?, updated_at = ? WHERE id = ?',
      name,
      timezone,
      notes,
      nowIso(),
      site.id,
    );
    res.json({ site: get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', site.id) });
  });

  router.post('/sites/:id/groups', (req, res) => {
    const name = asTrimmed(req.body?.name, 120);
    if (!name) throw new Error('화면 그룹 이름을 입력해 주세요.');
    res.status(201).json({ group: createDisplayGroup(db, req.params.id, name) });
  });

  router.put('/groups/:id', (req, res) => {
    const group = requireGroup(db, req.params.id);
    const name = req.body?.name === undefined ? group.name : asTrimmed(req.body.name, 120) || group.name;
    const playlistId = req.body?.playlistId === undefined ? group.playlist_id : playlistExists(db, req.body.playlistId);
    const playbackMode = ['individual', 'synchronized-cycle', 'mirror', 'canvas'].includes(req.body?.playbackMode)
      ? req.body.playbackMode as PlaybackMode
      : group.playback_mode;
    const dwellMs = Number(req.body?.dwellMs ?? group.dwell_ms);
    if (!Number.isFinite(dwellMs) || dwellMs < 1000 || dwellMs > 3_600_000) {
      throw new Error('전환 간격은 1초~1시간 범위로 입력해 주세요.');
    }
    const epoch = req.body?.resetEpoch === true ? nowIso() : group.epoch;
    run(
      db,
      `UPDATE display_groups SET name = ?, playlist_id = ?, playback_mode = ?, dwell_ms = ?,
                                epoch = ?, updated_at = ? WHERE id = ?`,
      name,
      playlistId,
      playbackMode,
      dwellMs,
      epoch,
      nowIso(),
      group.id,
    );
    res.json({ group: requireGroup(db, group.id) });
  });

  router.put('/groups/:id/configuration', (req, res) => {
    const group = requireGroup(db, req.params.id);
    const first = get<{ width: number; height: number }>(
      db,
      'SELECT width, height FROM displays WHERE group_id = ? ORDER BY created_at, id LIMIT 1',
      group.id,
    );
    const input = parseGroupConfiguration(req.body || {}, first);
    configureGroupDisplays(db, group.id, input);
    res.json({ group: requireGroup(db, group.id), preview: previewWall(db, group.id, { heartbeatOnlineMs: config.heartbeatOnlineMs }) });
  });

  router.put('/displays/:id', (req, res) => {
    const orientation = req.body?.orientation as Orientation | undefined;
    const rotation = req.body?.rotation === undefined ? undefined : Number(req.body.rotation) as DisplayRotation;
    const fitMode = req.body?.fitMode as FitMode | undefined;
    const rawNativeMonitorId: unknown = req.body?.nativeMonitorId;
    let nativeMonitorId: string | null | undefined;
    if (rawNativeMonitorId !== undefined) {
      if (rawNativeMonitorId !== null && typeof rawNativeMonitorId !== 'string') {
        throw new Error('물리 모니터 ID 형식이 올바르지 않습니다.');
      }
      const normalized = typeof rawNativeMonitorId === 'string' ? rawNativeMonitorId.trim() : '';
      if (normalized.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
        throw new Error('물리 모니터 ID는 제어문자 없이 512자 이내로 입력해 주세요.');
      }
      if (normalized && !/^MONITOR\\/iu.test(normalized)) {
        throw new Error('연결 단자 이름이 아닌 Windows 모니터 장치 ID를 선택해 주세요.');
      }
      nativeMonitorId = normalized || null;
    }
    updateDisplay(db, req.params.id, config.heartbeatOnlineMs, {
      name: req.body?.name === undefined ? undefined : asTrimmed(req.body.name, 120),
      playlistId: req.body?.playlistId === undefined ? undefined : playlistExists(db, req.body.playlistId),
      width: req.body?.width === undefined ? undefined : Number(req.body.width),
      height: req.body?.height === undefined ? undefined : Number(req.body.height),
      orientation,
      rotation,
      fitMode,
      deviceId: req.body?.deviceId === undefined ? undefined : asTrimmed(req.body.deviceId, 100) || null,
      nativeMonitorId,
      startIndex: req.body?.startIndex === undefined ? undefined : Number(req.body.startIndex),
      step: req.body?.step === undefined ? undefined : Number(req.body.step),
    });
    const display = get<{ group_id: string; native_monitor_id: string | null }>(db, 'SELECT group_id, native_monitor_id FROM displays WHERE id = ?', req.params.id);
    res.json({
      nativeMonitorId: display?.native_monitor_id ?? null,
      preview: display ? previewWall(db, display.group_id, { heartbeatOnlineMs: config.heartbeatOnlineMs }) : null,
    });
  });

  router.get('/groups/:id/preview', (req, res) => {
    const group = requireGroup(db, req.params.id);
    const rawAt = typeof req.query.at === 'string' ? req.query.at : '';
    const parsedAt = rawAt ? Date.parse(rawAt) : Number.NaN;
    res.json(previewWall(db, group.id, {
      atMs: Number.isFinite(parsedAt) ? parsedAt : undefined,
      heartbeatOnlineMs: config.heartbeatOnlineMs,
    }));
  });

  router.post('/groups/:id/publish', (req, res) => {
    const group = requireGroup(db, req.params.id);
    const wall = buildWallSnapshot(db, group.id, { heartbeatOnlineMs: config.heartbeatOnlineMs });
    const published = publishGroupSnapshot(db, wall);
    res.json({ ...published, wall });
  });

  return router;
}
