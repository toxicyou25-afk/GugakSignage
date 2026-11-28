/* SPDX-License-Identifier: Apache-2.0 */
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_INTENT_HEADER = 'x-gugak-request';

function sameOrigin(req: Request): boolean {
  const source = req.get('origin') || req.get('referer');
  if (!source) return true;

  const host = req.get('host');
  if (!host) return false;
  try {
    const parsedSource = new URL(source);
    if (parsedSource.protocol !== 'http:' && parsedSource.protocol !== 'https:') return false;
    const protocol = req.secure ? 'https:' : 'http:';
    const requestOrigin = new URL(`${protocol}//${host}`).origin;
    return parsedSource.origin === requestOrigin;
  } catch {
    return false;
  }
}

export function requireAdminRequestIntent(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) { next(); return; }
  if (req.get(ADMIN_INTENT_HEADER) !== '1' || !sameOrigin(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.' });
    return;
  }
  next();
}
