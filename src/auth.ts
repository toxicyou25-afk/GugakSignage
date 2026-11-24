/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'signage_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export function passwordMatches(expected: string, supplied: unknown): boolean {
  const suppliedString = typeof supplied === 'string' ? supplied : '';
  return crypto.timingSafeEqual(digest(expected), digest(suppliedString));
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `admin.${expires}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresRaw, signature] = parts;
  if (role !== 'admin' || !expiresRaw || !signature) return false;
  const expected = sign(secret, `${role}.${expiresRaw}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  const expires = Number.parseInt(expiresRaw, 10);
  return Number.isFinite(expires) && expires * 1000 > now;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

export function isAdminRequest(req: Request, secret: string): boolean {
  return verifySessionToken(secret, readCookie(req, COOKIE_NAME));
}

export function requireAdmin(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAdminRequest(req, secret)) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    next();
  };
}

export function setSessionCookie(res: Response, secret: string): void {
  res.cookie(COOKIE_NAME, createSessionToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
