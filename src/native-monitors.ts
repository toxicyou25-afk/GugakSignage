// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export interface NativeMonitor {
  stableId: string; bindingId: string | null; deviceName: string; friendlyName: string; bounds: { x: number; y: number; width: number; height: number };
  resolution: { width: number; height: number }; orientation: 'landscape' | 'portrait'; primary: boolean; attached: boolean;
  identityStatus?: 'supplement-qualified' | 'ambiguous' | 'unavailable';
}
export interface NativeMonitorCandidate extends NativeMonitor { deviceId?: string; deviceKey?: string; }
export interface NativeMonitorResult {
  supported: boolean; detectedAt: string; monitors: NativeMonitor[]; error?: string;
}
export type MonitorChangeAttribute = 'bounds' | 'resolution' | 'orientation' | 'primary' | 'deviceName' | 'identity';
export type MonitorChange =
  | { type: 'connected' | 'disconnected'; stableId: string; monitor: NativeMonitor }
  | { type: 'changed'; stableId: string; monitor: NativeMonitor; changedAttributes: MonitorChangeAttribute[] };

const emptyResult = (detectedAt: string, error: string): NativeMonitorResult => ({ supported: true, detectedAt, monitors: [], error });

function identityFingerprint(value: string): string {
  return createHash('sha256').update(value.trim().toLocaleLowerCase('en-US')).digest('hex').slice(0, 16);
}

function appendIdentitySuffix(value: string, suffix: string): string {
  const separator = '|';
  return `${value.slice(0, Math.max(1, 512 - separator.length - suffix.length))}${separator}${suffix}`;
}

export function normalizeNativeMonitorIdentities(candidates: readonly NativeMonitorCandidate[]): NativeMonitor[] {
  const deviceIdCounts = new Map<string, number>();
  const bindingIdCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const deviceId = candidate.deviceId?.trim() || candidate.stableId.trim();
    deviceIdCounts.set(deviceId, (deviceIdCounts.get(deviceId) ?? 0) + 1);
    if (candidate.bindingId) bindingIdCounts.set(candidate.bindingId, (bindingIdCounts.get(candidate.bindingId) ?? 0) + 1);
  }

  return candidates.map((candidate, index) => {
    const { deviceId: rawDeviceId, deviceKey: rawDeviceKey, ...monitor } = candidate;
    const deviceId = rawDeviceId?.trim() || candidate.stableId.trim();
    const bindingId = candidate.bindingId;
    const duplicateDeviceId = (deviceIdCounts.get(deviceId) ?? 0) > 1;
    const duplicateBindingId = Boolean(bindingId && (bindingIdCounts.get(bindingId) ?? 0) > 1);
    if (!duplicateDeviceId && !duplicateBindingId) {
      const identityStatus = candidate.identityStatus ?? (bindingId ? undefined : 'unavailable');
      return {
        ...monitor,
        stableId: deviceId,
        ...(identityStatus ? { identityStatus } : {}),
      };
    }

    const deviceKey = rawDeviceKey?.trim() ?? '';
    const matchingDeviceKeys = candidates.filter((other) =>
      (other.deviceId?.trim() || other.stableId.trim()) === deviceId && other.deviceKey?.trim() === deviceKey
    ).length;
    const bindingIsUnique = Boolean(bindingId && bindingIdCounts.get(bindingId) === 1);
    const supplementalDiscriminator = deviceKey && matchingDeviceKeys === 1
      ? deviceKey
      : bindingIsUnique ? bindingId! : '';

    if (supplementalDiscriminator) {
      const suffix = `KEY-${identityFingerprint(supplementalDiscriminator)}`;
      return {
        ...monitor,
        stableId: appendIdentitySuffix(deviceId, suffix),
        bindingId: !bindingId ? null : !duplicateBindingId ? bindingId : appendIdentitySuffix(bindingId, suffix),
        identityStatus: bindingId ? 'supplement-qualified' : 'unavailable',
      };
    }

    const suffix = `OUTPUT-${identityFingerprint(`${candidate.deviceName}\u0000${index}`)}`;
    return {
      ...monitor,
      stableId: appendIdentitySuffix(deviceId, suffix),
      bindingId: bindingId ? appendIdentitySuffix(bindingId, suffix) : null,
      identityStatus: 'ambiguous',
    };
  });
}

export function parseNativeMonitorOutput(output: string, detectedAt = new Date().toISOString()): NativeMonitorResult {
  try {
    const value = JSON.parse(output) as { supported?: unknown; monitors?: unknown };
    if (value.supported !== true || !Array.isArray(value.monitors)) {
      return emptyResult(detectedAt, 'Windows display discovery returned no monitor data.');
    }
    if (typeof (value as { error?: unknown }).error === 'string' && (value as { error: string }).error) {
      return emptyResult(detectedAt, (value as { error: string }).error);
    }
    const candidates: NativeMonitorCandidate[] = [];
    for (const raw of value.monitors) {
      if (!raw || typeof raw !== 'object') return emptyResult(detectedAt, 'Windows display discovery returned invalid monitor data.');
      const m = raw as Record<string, unknown>;
      const numbers = ['x', 'y', 'width', 'height'].map((key) => m[key]);
      if (['stableId', 'deviceName', 'friendlyName'].some((key) => typeof m[key] !== 'string' || !(m[key] as string).trim()) ||
          (m.deviceId !== undefined && (typeof m.deviceId !== 'string' || !m.deviceId.trim() || m.deviceId.length > 512)) ||
          (m.deviceKey !== undefined && (typeof m.deviceKey !== 'string' || m.deviceKey.length > 256)) ||
          numbers.some((n, index) => typeof n !== 'number' || !Number.isFinite(n) || (index > 1 && n <= 0)) ||
          !['landscape', 'portrait'].includes(String(m.orientation)) || typeof m.primary !== 'boolean' || typeof m.attached !== 'boolean') {
        return emptyResult(detectedAt, 'Windows display discovery returned invalid monitor data.');
      }
      const validatedNumbers = numbers as number[];
      const x = validatedNumbers[0]!;
      const y = validatedNumbers[1]!;
      const width = validatedNumbers[2]!;
      const height = validatedNumbers[3]!;
      const stableId = (m.stableId as string).trim();
      const rawBindingId = typeof m.bindingId === 'string' ? m.bindingId.trim() : '';
      const bindingId = rawBindingId.length <= 512 && /^MONITOR\\/iu.test(rawBindingId) ? rawBindingId : null;
      candidates.push({
        stableId, bindingId, deviceId: typeof m.deviceId === 'string' ? m.deviceId : stableId,
        deviceKey: typeof m.deviceKey === 'string' ? m.deviceKey : undefined,
        deviceName: m.deviceName as string, friendlyName: m.friendlyName as string,
        bounds: { x, y, width, height }, resolution: { width, height }, orientation: m.orientation as NativeMonitor['orientation'],
        primary: m.primary, attached: m.attached,
      });
    }
    const monitors = normalizeNativeMonitorIdentities(candidates);
    return { supported: true, detectedAt, monitors };
  } catch {
    return emptyResult(detectedAt, 'Windows display discovery returned no monitor data.');
  }
}

export function compareMonitorSnapshots(
  previous: readonly NativeMonitor[] | null,
  current: readonly NativeMonitor[],
): MonitorChange[] {
  const before = new Map((previous || []).map((monitor) => [monitor.stableId, monitor]));
  const after = new Map(current.map((monitor) => [monitor.stableId, monitor]));
  const changes: MonitorChange[] = [];

  if (previous === null) {
    return changes;
  }

  for (const monitor of previous) {
    const next = after.get(monitor.stableId);
    if (!next) {
      changes.push({ type: 'disconnected', stableId: monitor.stableId, monitor });
      continue;
    }
    const changedAttributes: MonitorChangeAttribute[] = [];
    if (monitor.bounds.x !== next.bounds.x || monitor.bounds.y !== next.bounds.y ||
        monitor.bounds.width !== next.bounds.width || monitor.bounds.height !== next.bounds.height) changedAttributes.push('bounds');
    if (monitor.resolution.width !== next.resolution.width || monitor.resolution.height !== next.resolution.height) changedAttributes.push('resolution');
    if (monitor.orientation !== next.orientation) changedAttributes.push('orientation');
    if (monitor.primary !== next.primary) changedAttributes.push('primary');
    if (monitor.deviceName !== next.deviceName) changedAttributes.push('deviceName');
    if (monitor.bindingId !== next.bindingId || monitor.identityStatus !== next.identityStatus) changedAttributes.push('identity');
    if (changedAttributes.length) changes.push({ type: 'changed', stableId: monitor.stableId, monitor: next, changedAttributes });
  }
  for (const monitor of current) {
    if (!before.has(monitor.stableId)) changes.push({ type: 'connected', stableId: monitor.stableId, monitor });
  }
  return changes;
}

export class NativeMonitorSnapshotTracker {
  private previous: NativeMonitor[] | null = null;

  update(result: NativeMonitorResult): NativeMonitorResult & { changes: MonitorChange[] } {
    if (!result.supported || result.error) return { ...result, changes: [] };
    const changes = compareMonitorSnapshots(this.previous, result.monitors);
    this.previous = result.monitors;
    return { ...result, changes };
  }
}

export async function discoverNativeMonitors(platform = process.platform, rootDir = process.cwd()): Promise<NativeMonitorResult> {
  const detectedAt = new Date().toISOString();
  if (platform !== 'win32') return { supported: false, detectedAt, monitors: [], error: 'Physical monitor discovery is supported only on Windows.' };
  const candidates = [path.join(rootDir, 'ops', 'get-native-monitors.ps1'), path.join(rootDir, 'installer', 'ops', 'get-native-monitors.ps1')];
  const script = candidates.find((candidate) => fs.existsSync(candidate));
  if (!script) return emptyResult(detectedAt, 'Windows display discovery helper is unavailable.');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true,
    });
    return parseNativeMonitorOutput(stdout, detectedAt);
  } catch {
    return emptyResult(detectedAt, 'Windows display discovery could not be completed.');
  }
}
