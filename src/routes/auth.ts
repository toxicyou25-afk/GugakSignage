/* SPDX-License-Identifier: Apache-2.0 */
import { Router } from 'express';
import { clearSessionCookie, isAdminRequest, passwordMatches, setSessionCookie } from '../auth.js';
import type { AppConfig } from '../config.js';

export function authRoutes(config: AppConfig): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    res.json({ authenticated: isAdminRequest(req, config.sessionSecret) });
  });

  router.post('/login', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!passwordMatches(config.adminPassword, password)) {
      res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      return;
    }
    setSessionCookie(res, config.sessionSecret);
    res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
