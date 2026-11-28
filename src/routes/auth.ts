/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import { clearSessionCookie, isAdminRequest, setSessionCookie } from '../auth.js';
import { adminSessionEpoch, changeAdminPassword, usesTestDefaultAdminPassword, verifyAdminPassword } from '../admin-password.js';
import type { AppConfig } from '../config.js';
import type { DB } from '../db.js';

export function authRoutes(db: DB, config: AppConfig): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: isAdminRequest(req, config.sessionSecret, adminSessionEpoch(db)),
      defaultPasswordWarning: usesTestDefaultAdminPassword(db),
    });
  });

  router.post('/login', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    res.setHeader('Cache-Control', 'no-store');
    if (!verifyAdminPassword(db, password)) {
      res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      return;
    }
    setSessionCookie(res, config.sessionSecret, adminSessionEpoch(db), config.role === 'manager' && config.mode !== 'standalone');
    res.json({ ok: true });
  });

  router.post('/change-password', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (!isAdminRequest(req, config.sessionSecret, adminSessionEpoch(db))) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    if (!currentPassword || currentPassword.length > 1024 || !verifyAdminPassword(db, currentPassword)) {
      res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.', field: 'currentPassword' });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: '새 비밀번호 확인이 일치하지 않습니다.', field: 'confirmPassword' });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: '새 비밀번호는 8자 이상 128자 이하여야 합니다.', field: 'newPassword' });
      return;
    }
    if (!changeAdminPassword(db, currentPassword, newPassword)) {
      res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.', field: 'currentPassword' });
      return;
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
