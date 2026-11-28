/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'signage_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function assertManagerPasswordChanged(isTestDefault: boolean): void {
  if (isTestDefault) {
    throw new Error('Manager LAN/central mode refuses to start while the stored administrator password is the test default. Change it in standalone mode first.');
  }
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, sessionEpoch = '0', now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = sessionEpoch === '0' ? `admin.${expires}` : `admin.${sessionEpoch}.${expires}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(
  secret: string,
  token: string | undefined,
  sessionEpoch = '0',
  now = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  let role: string | undefined;
  let expiresRaw: string | undefined;
  let signature: string | undefined;
  let payload: string;
  if (sessionEpoch === '0') {
    if (parts.length !== 3) return false;
    [role, expiresRaw, signature] = parts;
    payload = `${role}.${expiresRaw}`;
  } else {
    if (parts.length !== 4) return false;
    const tokenEpoch = parts[1];
    if (tokenEpoch !== sessionEpoch) return false;
    [role, , expiresRaw, signature] = parts;
    payload = `${role}.${tokenEpoch}.${expiresRaw}`;
  }
  if (role !== 'admin' || !expiresRaw || !signature) return false;
  const expected = sign(secret, payload);
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

export function isAdminRequest(req: Request, secret: string, sessionEpoch = '0'): boolean {
  return verifySessionToken(secret, readCookie(req, COOKIE_NAME), sessionEpoch);
}

export function requireAdmin(secret: string, getSessionEpoch: () => string = () => '0') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAdminRequest(req, secret, getSessionEpoch())) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    next();
  };
}

export function setSessionCookie(res: Response, secret: string, sessionEpoch = '0', secure = false): void {
  res.cookie(COOKIE_NAME, createSessionToken(secret, sessionEpoch), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
