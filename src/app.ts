/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';
import { createRequire } from 'node:module';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import { restrictAdminToLoopback } from './admin-access.js';
import { isAdminRequest, requireAdmin } from './auth.js';
import { adminSessionEpoch, initializeAdminPassword, usesTestDefaultAdminPassword } from './admin-password.js';
import type { AppConfig } from './config.js';
import { get, getMeta, setMeta, type DB } from './db.js';
import { initializePlayerControl } from './player-control.js';
import { discoverNativeMonitors, NativeMonitorSnapshotTracker } from './native-monitors.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/contents.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/devices.js';
import { playerRoutes } from './routes/player.js';
import { playerControlRoutes } from './routes/player-control.js';
import { playlistRoutes } from './routes/playlists.js';
import { topologyRoutes } from './routes/topology.js';
import { hashPlayerToken } from './util.js';

type DecodedImage = { width: number; height: number; data: Uint8Array };
const require = createRequire(import.meta.url);
const pngDecoder = require('pngjs') as {
  PNG: { sync: { read: (buffer: Buffer, options?: { checkCRC?: boolean }) => DecodedImage } };
};
const jpegDecoder = require('jpeg-js') as {
  decode: (buffer: Buffer, options: {
    tolerantDecoding: boolean;
    maxResolutionInMP: number;
    maxMemoryUsageInMB: number;
  }) => DecodedImage;
};

export function createApp(db: DB, config: AppConfig) {
  const nativeMonitorTracker = new NativeMonitorSnapshotTracker();
  initializePlayerControl(config);
  initializeAdminPassword(db, config);
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; frame-src 'self' http: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Read the stored password state per request. Once the test default is replaced,
  // the same server process may accept administrator requests from the LAN.
  const localOnlyAdmin = restrictAdminToLoopback(() => usesTestDefaultAdminPassword(db));
  const admin = [localOnlyAdmin, requireAdmin(config.sessionSecret, () => adminSessionEpoch(db))];

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'gugak-signage', time: new Date().toISOString() });
  });
  app.get('/api/time', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ serverTime: new Date().toISOString(), serverTimeMs: Date.now() });
  });
  app.use('/api/auth', localOnlyAdmin, authRoutes(db, config));
  app.use('/api/player', playerRoutes(db, config));
  app.use('/api/player', admin, playerControlRoutes(db, config));
  app.get('/api/native-monitors', admin, async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : '';
    if (deviceId) {
      const device = get<{ id: string; last_host_local: number; last_seen: string | null }>(db, 'SELECT id, last_host_local, last_seen FROM devices WHERE id = ?', deviceId);
      if (!device) { res.status(404).json({ error: '기기를 찾을 수 없습니다.' }); return; }
      const lastSeen = device.last_seen ? Date.parse(device.last_seen) : Number.NaN;
      const heartbeatAge = Date.now() - lastSeen;
      const playerOnline = Number.isFinite(lastSeen) && heartbeatAge >= 0 && heartbeatAge <= config.heartbeatOnlineMs;
      if (!playerOnline) {
        res.json({
          supported: true,
          detectedAt: new Date().toISOString(),
          monitors: [],
          error: '해당 Player PC의 실제 모니터 정보가 보고되지 않았습니다.',
        });
        return;
      }
      if (device.last_host_local === 0) {
        const report = get<{ snapshot_json: string; reported_at: string }>(db, 'SELECT snapshot_json, reported_at FROM player_monitor_reports WHERE device_id = ?', device.id);
        if (!report) { res.json({ supported: true, detectedAt: null, monitors: [], reported: false, error: '해당 Player PC의 실제 모니터 정보가 보고되지 않았습니다.' }); return; }
        res.json({ supported: true, detectedAt: report.reported_at, monitors: JSON.parse(report.snapshot_json), reported: true });
        return;
      }
    }
    res.json(nativeMonitorTracker.update(await discoverNativeMonitors(process.platform, config.rootDir)));
  });
  const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024, files: 1 } });
  app.get('/api/settings/logo', admin, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ dataUrl: getMeta(db, 'institution_logo') || null });
  });
  app.put('/api/settings/logo', admin, logoUpload.single('logo'), (req: Request, res: Response) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: '로고 파일을 선택하세요.' }); return; }
    try {
      const info = imageSize(file.buffer);
      const mime = info.type === 'png' ? 'image/png' : info.type === 'jpg' ? 'image/jpeg' : null;
      if (!mime || !info.width || !info.height || info.width > 2048 || info.height > 2048) {
        res.status(400).json({ error: '2048×2048 이하의 PNG 또는 JPEG 파일만 사용할 수 있습니다.' }); return;
      }
      const decoded = info.type === 'png'
        ? pngDecoder.PNG.sync.read(file.buffer, { checkCRC: true })
        : jpegDecoder.decode(file.buffer, {
            tolerantDecoding: false,
            maxResolutionInMP: 4.2,
            maxMemoryUsageInMB: 64,
          });
      if (decoded.width !== info.width || decoded.height !== info.height || decoded.data.byteLength !== info.width * info.height * 4) {
        res.status(400).json({ error: '올바른 이미지 파일이 아닙니다.' }); return;
      }
      const dataUrl = 'data:' + mime + ';base64,' + file.buffer.toString('base64');
      setMeta(db, 'institution_logo', dataUrl);
      res.json({ dataUrl });
    } catch {
      res.status(400).json({ error: '올바른 이미지 파일이 아닙니다.' });
    }
  });
  app.delete('/api/settings/logo', admin, (_req: Request, res: Response) => {
    setMeta(db, 'institution_logo', '');
    res.json({ dataUrl: null });
  });
  app.get('/api/settings/institution', admin, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ name: getMeta(db, 'institution_name') ?? '' });
  });
  app.put('/api/settings/institution', admin, (req: Request, res: Response) => {
    const raw: unknown = req.body?.name;
    if (typeof raw !== 'string' || raw.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) {
      res.status(400).json({ error: '기관명은 제어문자 없이 100자 이내로 입력하세요.' });
      return;
    }
    const name = raw.trim();
    setMeta(db, 'institution_name', name);
    res.json({ name });
  });
  app.use('/api/dashboard', admin, dashboardRoutes(db, config));
  app.use('/api/contents', admin, contentRoutes(db, config));
  app.use('/api/playlists', admin, playlistRoutes(db));
  app.use('/api/devices', admin, deviceRoutes(db, config));
  app.use('/api', admin, topologyRoutes(db, config));

  if (config.mode !== 'standalone') {
    app.use('/media', (req, res, next) => {
      if (isAdminRequest(req, config.sessionSecret, adminSessionEpoch(db))) { next(); return; }
      const authorization = req.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) { res.status(401).json({ error: '재생기 인증이 필요합니다.' }); return; }
      const device = get<{ id: string; published_version: number }>(db,
        'SELECT id, published_version FROM devices WHERE player_token_hash = ? AND hardware_id IS NOT NULL', hashPlayerToken(token));
      if (!device) { res.status(401).json({ error: '재생기 인증이 필요합니다.' }); return; }
      let storedName: string;
      try {
        const rawPath = req.originalUrl.split('?', 1)[0]!.slice('/media/'.length);
        storedName = decodeURIComponent(rawPath);
      } catch { res.status(400).json({ error: '미디어 경로가 올바르지 않습니다.' }); return; }
      if (!storedName || storedName === '.' || storedName === '..' || /[\\/\0]/u.test(storedName)) {
        res.status(400).json({ error: '미디어 경로가 올바르지 않습니다.' }); return;
      }
      const publication = get<{ snapshot: string }>(db,
        'SELECT snapshot FROM publications WHERE device_id = ? AND version = ?', device.id, device.published_version);
      if (!publication) { res.status(403).json({ error: '게시된 미디어에 접근할 수 없습니다.' }); return; }
      let found = false;
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object' || found) return;
        if (Array.isArray(value)) { for (const item of value) visit(item); return; }
        for (const [key, child] of Object.entries(value)) {
          if (key === 'url' && typeof child === 'string') {
            try {
              const pathname = new URL(child, 'http://manager.local').pathname;
              const mediaPath = pathname.startsWith('/media/') ? decodeURIComponent(pathname.slice('/media/'.length)) : '';
              if (mediaPath === storedName) found = true;
            } catch { /* Malformed or unrelated URLs cannot grant access. */ }
          } else visit(child);
        }
      };
      try { visit(JSON.parse(publication.snapshot) as unknown); } catch { /* Invalid snapshots grant no access. */ }
      if (!found) { res.status(403).json({ error: '게시된 미디어에 접근할 수 없습니다.' }); return; }
      next();
    });
  }
  app.use(
    '/media',
    express.static(config.uploadDir, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      maxAge: '1h',
      setHeaders: (res) => {
        res.setHeader('Cache-Control', config.mode === 'standalone' ? 'public, max-age=3600' : 'private, no-store');
      },
    }),
  );
  app.use('/sample', express.static(path.join(config.rootDir, 'public', 'sample'), { index: 'notice.html' }));
  app.use('/engine', express.static(path.join(config.rootDir, 'poc', 'packages', 'engine'), { index: false }));
  app.use('/player', express.static(path.join(config.rootDir, 'public', 'player'), { index: 'index.html' }));
  app.use('/admin', localOnlyAdmin, express.static(path.join(config.rootDir, 'public', 'admin'), { index: 'index.html' }));

  app.get('/', (_req, res) => res.redirect('/admin/'));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `파일이 너무 큽니다. 한 파일은 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB까지 올릴 수 있습니다.`
          : `업로드에 실패했습니다: ${error.message}`;
      res.status(400).json({ error: message });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: '요청 내용이 올바른 JSON이 아닙니다.' });
      return;
    }
    if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof Error) {
      console.error('[signage] 요청 처리 오류:', error);
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[signage] 알 수 없는 오류:', error);
    res.status(500).json({ error: '서버에서 처리하지 못했습니다.' });
  });

  return app;
}
