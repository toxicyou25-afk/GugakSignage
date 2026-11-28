/* SPDX-License-Identifier: Apache-2.0 */
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';

const PROXY_HEADERS = [
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-client-ip',
  'x-original-forwarded-for',
  'cf-connecting-ip',
  'true-client-ip',
];

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const withoutScope = address.split('%', 1)[0]!.toLowerCase();
  if (withoutScope === '::1') return true;
  const ipv4 = withoutScope.startsWith('::ffff:') ? withoutScope.slice('::ffff:'.length) : withoutScope;
  return net.isIPv4(ipv4) && ipv4.startsWith('127.');
}

export function isLoopbackBindHost(host: string): boolean {
  return host.toLowerCase() === 'localhost' || isLoopbackAddress(host);
}

function hasProxyHeaders(req: Request): boolean {
  return PROXY_HEADERS.some((header) => req.headers[header] !== undefined);
}

export function isDirectLoopbackRequest(req: Pick<Request, 'headers' | 'socket'>): boolean {
  return isLoopbackAddress(req.socket.remoteAddress) && !hasProxyHeaders(req as Request);
}

export function restrictAdminToLoopback(isDefaultPassword: () => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isDefaultPassword() || (isLoopbackAddress(req.socket.remoteAddress) && !hasProxyHeaders(req))) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({
      error: '테스트 기본 비밀번호가 설정되어 있어 관리자 기능은 서버 PC에서만 사용할 수 있습니다. 서버 PC에서 비밀번호를 변경한 뒤 다시 시도하세요.',
    });
  };
}
