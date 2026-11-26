// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export interface NativeMonitor {
  stableId: string; deviceName: string; friendlyName: string; bounds: { x: number; y: number; width: number; height: number };
  resolution: { width: number; height: number }; orientation: 'landscape' | 'portrait'; primary: boolean; attached: boolean;
}
export interface NativeMonitorResult {
  supported: boolean; detectedAt: string; monitors: NativeMonitor[]; error?: string;
}
export type MonitorChangeAttribute = 'bounds' | 'resolution' | 'orientation' | 'primary';
export type MonitorChange =
  | { type: 'connected' | 'disconnected'; stableId: string; monitor: NativeMonitor }
  | { type: 'changed'; stableId: string; monitor: NativeMonitor; changedAttributes: MonitorChangeAttribute[] };

const emptyResult = (detectedAt: string, error: string): NativeMonitorResult => ({ supported: true, detectedAt, monitors: [], error });

export function parseNativeMonitorOutput(output: string, detectedAt = new Date().toISOString()): NativeMonitorResult {
  try {
    const value = JSON.parse(output) as { supported?: unknown; monitors?: unknown };
    if (value.supported !== true || !Array.isArray(value.monitors)) {
      return emptyResult(detectedAt, 'Windows display discovery returned no monitor data.');
    }
    const monitors: NativeMonitor[] = [];
    for (const raw of value.monitors) {
      if (!raw || typeof raw !== 'object') return emptyResult(detectedAt, 'Windows display discovery returned invalid monitor data.');
      const m = raw as Record<string, unknown>;
      const numbers = ['x', 'y', 'width', 'height'].map((key) => m[key]);
      if (['stableId', 'deviceName', 'friendlyName'].some((key) => typeof m[key] !== 'string' || !(m[key] as string).trim()) ||
          numbers.some((n, index) => typeof n !== 'number' || !Number.isFinite(n) || (index > 1 && n <= 0)) ||
          !['landscape', 'portrait'].includes(String(m.orientation)) || typeof m.primary !== 'boolean' || typeof m.attached !== 'boolean') {
        return emptyResult(detectedAt, 'Windows display discovery returned invalid monitor data.');
      }
      const validatedNumbers = numbers as number[];
      const x = validatedNumbers[0]!;
      const y = validatedNumbers[1]!;
      const width = validatedNumbers[2]!;
      const height = validatedNumbers[3]!;
      monitors.push({
        stableId: m.stableId as string, deviceName: m.deviceName as string, friendlyName: m.friendlyName as string,
        bounds: { x, y, width, height }, resolution: { width, height }, orientation: m.orientation as NativeMonitor['orientation'],
        primary: m.primary, attached: m.attached,
      });
    }
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
