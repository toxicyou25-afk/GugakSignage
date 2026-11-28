/* SPDX-License-Identifier: Apache-2.0 */
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { all, get, run, transaction, type DB } from './db.js';
import { id } from './util.js';

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_MS = 10 * 60_000;
const LOGIN_FAILURE_LIMIT = 5;
const MAX_AUDIT_EVENTS = 10_000;

type AdminAuditEventType =
  | 'admin.login.failed'
  | 'admin.login.rate_limited'
  | 'admin.login.succeeded'
  | 'admin.password.changed';

interface LoginAttemptRow {
  failed_count: number;
  window_started_at: string;
  blocked_until: string | null;
}

interface AdminAuditEventRow {
  id: string;
  event_type: AdminAuditEventType;
  outcome: 'failure' | 'rate_limited' | 'success';
  client_key_hash: string;
  occurred_at: string;
}

export function adminClientKeyHash(req: Pick<Request, 'socket'>, sessionSecret: string): string {
  // Use the direct socket peer; forwarding headers are not trusted for rate limiting.
  const address = req.socket.remoteAddress || 'unknown';
  return createHmac('sha256', sessionSecret).update(address, 'utf8').digest('hex');
}

export function adminLoginRetryAfterSeconds(db: DB, clientKeyHash: string, nowMs = Date.now()): number {
  const attempt = get<LoginAttemptRow>(db,
    'SELECT failed_count, window_started_at, blocked_until FROM admin_login_attempts WHERE client_key_hash = ?',
    clientKeyHash,
  );
  if (!attempt?.blocked_until) return 0;
  const blockedUntilMs = Date.parse(attempt.blocked_until);
  if (!Number.isFinite(blockedUntilMs) || blockedUntilMs <= nowMs) return 0;
  return Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000));
}

function appendAuditEvent(
  db: DB,
  clientKeyHash: string,
  eventType: AdminAuditEventType,
  outcome: AdminAuditEventRow['outcome'],
  occurredAt: string,
): void {
  run(db,
    'INSERT INTO admin_audit_events(id, event_type, outcome, client_key_hash, occurred_at) VALUES (?, ?, ?, ?, ?)',
    id(), eventType, outcome, clientKeyHash, occurredAt,
  );
  const count = get<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM admin_audit_events')?.count ?? 0;
  if (count > MAX_AUDIT_EVENTS) {
    run(db, `DELETE FROM admin_audit_events WHERE id IN (
      SELECT id FROM admin_audit_events ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET ?
    )`, MAX_AUDIT_EVENTS);
  }
}

export function recordAdminLoginFailure(
  db: DB,
  clientKeyHash: string,
  nowMs = Date.now(),
): { blocked: boolean; retryAfterSeconds: number } {
  const occurredAt = new Date(nowMs).toISOString();
  let blocked = false;
  let retryAfterSeconds = 0;
  transaction(db, () => {
    const previous = get<LoginAttemptRow>(db,
      'SELECT failed_count, window_started_at, blocked_until FROM admin_login_attempts WHERE client_key_hash = ?',
      clientKeyHash,
    );
    const previousWindowStart = previous ? Date.parse(previous.window_started_at) : Number.NaN;
    const previousBlockEnd = previous?.blocked_until ? Date.parse(previous.blocked_until) : Number.NaN;
    const windowExpired = !Number.isFinite(previousWindowStart) || nowMs - previousWindowStart >= LOGIN_WINDOW_MS ||
      (Number.isFinite(previousBlockEnd) && previousBlockEnd <= nowMs);
    const windowStartedAt = windowExpired ? occurredAt : previous!.window_started_at;
    const failedCount = windowExpired ? 1 : previous!.failed_count + 1;
    blocked = failedCount >= LOGIN_FAILURE_LIMIT;
    const blockedUntil = blocked ? new Date(nowMs + LOGIN_LOCK_MS).toISOString() : null;
    run(db, `INSERT INTO admin_login_attempts(client_key_hash, failed_count, window_started_at, blocked_until)
      VALUES (?, ?, ?, ?) ON CONFLICT(client_key_hash) DO UPDATE SET
      failed_count = excluded.failed_count, window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until`, clientKeyHash, failedCount, windowStartedAt, blockedUntil);
    appendAuditEvent(db, clientKeyHash,
      blocked ? 'admin.login.rate_limited' : 'admin.login.failed',
      blocked ? 'rate_limited' : 'failure', occurredAt);
    if (blocked) retryAfterSeconds = Math.ceil(LOGIN_LOCK_MS / 1000);
  });
  return { blocked, retryAfterSeconds };
}

export function recordAdminLoginSuccess(db: DB, clientKeyHash: string, nowMs = Date.now()): void {
  const occurredAt = new Date(nowMs).toISOString();
  transaction(db, () => {
    run(db, 'DELETE FROM admin_login_attempts WHERE client_key_hash = ?', clientKeyHash);
    appendAuditEvent(db, clientKeyHash, 'admin.login.succeeded', 'success', occurredAt);
  });
}

export function recordAdminPasswordChanged(db: DB, clientKeyHash: string, nowMs = Date.now()): void {
  appendAuditEvent(db, clientKeyHash, 'admin.password.changed', 'success', new Date(nowMs).toISOString());
}

export function recentAdminAuditEvents(db: DB, limit = 100): Array<{
  id: string;
  eventType: AdminAuditEventType;
  outcome: AdminAuditEventRow['outcome'];
  clientKey: string;
  occurredAt: string;
}> {
  return all<AdminAuditEventRow>(db,
    'SELECT id, event_type, outcome, client_key_hash, occurred_at FROM admin_audit_events ORDER BY occurred_at DESC, id DESC LIMIT ?',
    limit,
  ).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    outcome: row.outcome,
    clientKey: row.client_key_hash,
    occurredAt: row.occurred_at,
  }));
}
