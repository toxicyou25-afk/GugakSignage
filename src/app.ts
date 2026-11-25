/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { restrictAdminToLoopback } from './admin-access.js';
import { requireAdmin } from './auth.js';
import { adminSessionEpoch, initializeAdminPassword, usesTestDefaultAdminPassword } from './admin-password.js';
import type { AppConfig } from './config.js';
import type { DB } from './db.js';
import { initializePlayerControl } from './player-control.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/contents.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/devices.js';
import { playerRoutes } from './routes/player.js';
import { playerControlRoutes } from './routes/player-control.js';
import { playlistRoutes } from './routes/playlists.js';
import { topologyRoutes } from './routes/topology.js';

export function createApp(db: DB, config: AppConfig) {
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
  app.use('/api/dashboard', admin, dashboardRoutes(db, config));
  app.use('/api/contents', admin, contentRoutes(db, config));
  app.use('/api/playlists', admin, playlistRoutes(db));
  app.use('/api/devices', admin, deviceRoutes(db, config));
  app.use('/api', admin, topologyRoutes(db, config));

  app.use(
    '/media',
    express.static(config.uploadDir, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      maxAge: '1h',
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
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
