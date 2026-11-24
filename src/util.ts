/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import type { DeviceRow, DeviceStatus } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(): string {
  return crypto.randomUUID();
}

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newPairingCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const byte of bytes) code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return code;
}

export function newPlayerToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function normalizePairingCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function deviceStatus(device: DeviceRow, onlineMs: number, now = Date.now()): DeviceStatus {
  if (!device.hardware_id) return 'pending';
  if (!device.last_seen) return 'offline';
  const seen = Date.parse(device.last_seen);
  if (!Number.isFinite(seen)) return 'offline';
  return now - seen <= onlineMs ? 'online' : 'offline';
}

export function parseIntRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function asTrimmed(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim().slice(0, 64) || '';
  }
  return String(req.socket?.remoteAddress ?? '').slice(0, 64);
}
