/* SPDX-License-Identifier: Apache-2.0 */
import type { DeviceRow, DeviceStatus } from './types.js';
import { deviceStatus } from './util.js';

export type PlayerHealthState = DeviceStatus | 'degraded' | 'stale' | 'unknown';

export interface PlayerHealth {
  state: PlayerHealthState;
  heartbeatAgeMs: number | null;
  offlineSince: string | null;
  manifestBehind: boolean;
  attention: boolean;
}

/** Derive operator-facing health from persisted player reports, without a sweeper. */
export function playerHealth(device: DeviceRow, onlineMs: number, now = Date.now()): PlayerHealth {
  const lastSeenMs = device.last_seen ? Date.parse(device.last_seen) : Number.NaN;
  const heartbeatMs = device.last_heartbeat_at ? Date.parse(device.last_heartbeat_at) : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatMs) ? Math.max(0, now - heartbeatMs) : null;
  const status = deviceStatus(device, onlineMs, now);
  const manifestBehind = Boolean(
    device.hardware_id &&
    device.published_version > (device.manifest_version ?? 0),
  );
  let state: PlayerHealthState = status;
  if (status === 'online' && device.hardware_id && (device.player_state === 'offline' || device.player_state?.startsWith('offline:'))) state = 'degraded';
  else if (status === 'online' && device.hardware_id && device.cache_ready === 0) state = 'degraded';
  else if (status === 'online' && device.last_error) state = 'degraded';
  // last_seen is also updated by manifest polling. Only the heartbeat timestamp
  // is evidence that the player loop is alive; do not use last_seen here.
  if (status === 'online' && device.hardware_id) {
    if (!Number.isFinite(heartbeatMs) || now - heartbeatMs > onlineMs) state = 'stale';
  }
  const offlineSince = status === 'offline' && Number.isFinite(lastSeenMs)
    ? new Date(lastSeenMs + onlineMs).toISOString()
    : null;
  return {
    state,
    heartbeatAgeMs,
    offlineSince,
    manifestBehind,
    attention: state === 'offline' || state === 'degraded' || state === 'stale' || manifestBehind,
  };
}

export function summarizePlayerHealth(rows: PlayerHealth[]): {
  online: number;
  offline: number;
  pending: number;
  degraded: number;
  stale: number;
  behind: number;
  attention: number;
} {
  return rows.reduce((summary, health) => {
    if (health.state === 'online') summary.online += 1;
    else if (health.state === 'offline') summary.offline += 1;
    else if (health.state === 'pending') summary.pending += 1;
    else if (health.state === 'degraded') summary.degraded += 1;
    else if (health.state === 'stale') summary.stale += 1;
    if (health.manifestBehind) summary.behind += 1;
    if (health.attention) summary.attention += 1;
    return summary;
  }, { online: 0, offline: 0, pending: 0, degraded: 0, stale: 0, behind: 0, attention: 0 });
}
