/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { DeviceRow } from './types.js';

export type PlayerDesiredState = 'running' | 'stopped';

export interface PlayerScreenTarget {
  displayId: string;
  nativeMonitorId: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface PlayerControlState {
  schemaVersion: 1;
  desired: PlayerDesiredState;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  deviceId: string | null;
  playerUrl: string | null;
  screenTargets: PlayerScreenTarget[];
  lastError: string | null;
  updatedAt: string | null;
}

export interface PlayerCommand {
  schemaVersion: 1;
  id: string;
  serverInstanceId: string;
  action: 'launch' | 'stop';
  deviceId: string | null;
  deviceName: string | null;
  playerUrl: string | null;
  screenTargets: PlayerScreenTarget[];
  requestedAt: string;
}

export const DEFAULT_PLAYER_STATE: PlayerControlState = {
  schemaVersion: 1,
  desired: 'stopped',
  running: false,
  pid: null,
  startedAt: null,
  deviceId: null,
  playerUrl: null,
  screenTargets: [],
  lastError: null,
  updatedAt: null,
};

export function playerControlDir(dataDir: string): string {
  return path.join(dataDir, 'control');
}

export function playerStatePath(dataDir: string): string {
  return path.join(playerControlDir(dataDir), 'player-state.json');
}

export function playerCommandPath(dataDir: string): string {
  return path.join(playerControlDir(dataDir), 'player-command.json');
}

export function serverInstancePath(dataDir: string): string {
  return path.join(playerControlDir(dataDir), 'server-instance.json');
}

interface ServerInstance {
  schemaVersion: 1;
  id: string;
  pid: number;
  startedAt: string;
}

const serverInstances = new Map<string, ServerInstance>();

export function initializePlayerControl(config: AppConfig): ServerInstance {
  const dataDir = path.resolve(config.dataDir);
  const existing = serverInstances.get(dataDir);
  if (existing) return existing;
  const instance: ServerInstance = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  serverInstances.set(dataDir, instance);
  atomicWrite(serverInstancePath(dataDir), instance);
  return instance;
}

function currentServerInstance(config: AppConfig): ServerInstance {
  return initializePlayerControl(config);
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
}

export function normalizePlayerState(raw: unknown): PlayerControlState {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const pid = typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null;
  const running = value.running === true && pid !== null;
  return {
    schemaVersion: 1,
    desired: value.desired === 'running' ? 'running' : 'stopped',
    running,
    pid: running ? pid : null,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    deviceId: typeof value.deviceId === 'string' ? value.deviceId : null,
    playerUrl: typeof value.playerUrl === 'string' ? value.playerUrl : null,
    screenTargets: normalizePlayerScreenTargets(value.screenTargets),
    lastError: typeof value.lastError === 'string' ? value.lastError : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function normalizePlayerScreenTargets(value: unknown): PlayerScreenTarget[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const targets: PlayerScreenTarget[] = [];
  const displayIds = new Set<string>();
  const monitorIds = new Set<string>();
  for (const rawTarget of value) {
    if (!rawTarget || typeof rawTarget !== 'object') return [];
    const target = rawTarget as Record<string, unknown>;
    const displayId = typeof target.displayId === 'string' ? target.displayId.trim() : '';
    const nativeMonitorId = typeof target.nativeMonitorId === 'string' ? target.nativeMonitorId.trim() : '';
    if (!displayId || displayId.length > 100 || !nativeMonitorId || nativeMonitorId.length > 512 || !/^MONITOR\\/iu.test(nativeMonitorId) ||
        displayIds.has(displayId) || monitorIds.has(nativeMonitorId)) return [];
    const rawBounds = target.bounds;
    let bounds: PlayerScreenTarget['bounds'];
    if (rawBounds !== undefined) {
      if (!rawBounds || typeof rawBounds !== 'object') return [];
      const values = rawBounds as Record<string, unknown>;
      const { x, y, width, height } = values;
      if (![x, y, width, height].every(Number.isSafeInteger) ||
          (width as number) < 320 || (height as number) < 320 || (width as number) > 16384 || (height as number) > 16384) return [];
      bounds = { x: x as number, y: y as number, width: width as number, height: height as number };
    }
    displayIds.add(displayId);
    monitorIds.add(nativeMonitorId);
    targets.push({ displayId, nativeMonitorId, ...(bounds ? { bounds } : {}) });
  }
  return targets;
}

export function readPlayerState(dataDir: string): PlayerControlState {
  try {
    const raw = fs.readFileSync(playerStatePath(dataDir), 'utf8').replace(/^\uFEFF/, '');
    return normalizePlayerState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PLAYER_STATE };
  }
}

export function playerLaunchUrl(config: AppConfig, device: Pick<DeviceRow, 'pairing_code'>): string {
  const url = new URL('/player/', `http://127.0.0.1:${config.port}`);
  url.searchParams.set('code', device.pairing_code);
  url.searchParams.set('reconnect', '1');
  return url.toString();
}

export function requestPlayerLaunch(
  config: AppConfig,
  device: Pick<DeviceRow, 'id' | 'name' | 'pairing_code'>,
  screenTargets: PlayerScreenTarget[] = [],
): { command: PlayerCommand; state: PlayerControlState } {
  const requestedAt = new Date().toISOString();
  const serverInstance = currentServerInstance(config);
  const command: PlayerCommand = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    serverInstanceId: serverInstance.id,
    action: 'launch',
    deviceId: device.id,
    deviceName: device.name,
    playerUrl: playerLaunchUrl(config, device),
    screenTargets: normalizePlayerScreenTargets(screenTargets),
    requestedAt,
  };
  atomicWrite(playerCommandPath(config.dataDir), command);
  return { command, state: readPlayerState(config.dataDir) };
}

export function requestPlayerStop(config: AppConfig): { command: PlayerCommand; state: PlayerControlState } {
  const requestedAt = new Date().toISOString();
  const serverInstance = currentServerInstance(config);
  const command: PlayerCommand = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    serverInstanceId: serverInstance.id,
    action: 'stop',
    deviceId: null,
    deviceName: null,
    playerUrl: null,
    screenTargets: [],
    requestedAt,
  };
  atomicWrite(playerCommandPath(config.dataDir), command);
  return { command, state: readPlayerState(config.dataDir) };
}
