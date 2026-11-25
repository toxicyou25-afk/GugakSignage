// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';

export const PLAYER_STATE_SCHEMA_VERSION = 1;
export const PLAYER_COMMAND_TTL_MS = 30000;

export function controlDir(dataDir) {
  return path.join(dataDir, 'control');
}

export function playerStatePath(dataDir) {
  return path.join(controlDir(dataDir), 'player-state.json');
}

export function playerCommandPath(dataDir) {
  return path.join(controlDir(dataDir), 'player-command.json');
}

export function serverInstancePath(dataDir) {
  return path.join(controlDir(dataDir), 'server-instance.json');
}

export function defaultPlayerState() {
  return {
    schemaVersion: PLAYER_STATE_SCHEMA_VERSION,
    desired: 'stopped',
    running: false,
    pid: null,
    startedAt: null,
    deviceId: null,
    playerUrl: null,
    lastError: null,
    updatedAt: null,
  };
}

export function readPlayerState(dataDir) {
  try {
    const raw = fs.readFileSync(playerStatePath(dataDir), 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(raw);
    const pid = Number.isInteger(value?.pid) && value.pid > 0 ? value.pid : null;
    const running = value?.running === true && pid !== null;
    return {
      schemaVersion: PLAYER_STATE_SCHEMA_VERSION,
      desired: value?.desired === 'running' ? 'running' : 'stopped',
      running,
      pid: running ? pid : null,
      startedAt: typeof value?.startedAt === 'string' ? value.startedAt : null,
      deviceId: typeof value?.deviceId === 'string' ? value.deviceId : null,
      playerUrl: typeof value?.playerUrl === 'string' ? value.playerUrl : null,
      lastError: typeof value?.lastError === 'string' ? value.lastError : null,
      updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    };
  } catch {
    return defaultPlayerState();
  }
}

export function writePlayerState(dataDir, state) {
  fs.mkdirSync(controlDir(dataDir), { recursive: true });
  const filePath = playerStatePath(dataDir);
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
}

export function readPlayerCommand(dataDir) {
  try {
    const raw = fs.readFileSync(playerCommandPath(dataDir), 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(raw);
    if (value?.action !== 'launch' && value?.action !== 'stop') return null;
    return value;
  } catch {
    return null;
  }
}

export function readServerInstance(dataDir) {
  try {
    const raw = fs.readFileSync(serverInstancePath(dataDir), 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(raw);
    const pid = Number.isInteger(value?.pid) && value.pid > 0 ? value.pid : null;
    if (typeof value?.id !== 'string' || !value.id || pid === null) return null;
    return {
      schemaVersion: 1,
      id: value.id,
      pid,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    };
  } catch {
    return null;
  }
}

export function isPlayerCommandCurrent(command, {
  serverInstanceId,
  now = Date.now(),
  ttlMs = PLAYER_COMMAND_TTL_MS,
} = {}) {
  if (!command || (command.action !== 'launch' && command.action !== 'stop')) return false;
  if (!serverInstanceId || command.serverInstanceId !== serverInstanceId) return false;
  const requestedAt = Date.parse(String(command.requestedAt || ''));
  if (!Number.isFinite(requestedAt)) return false;
  const age = now - requestedAt;
  return age >= 0 && age <= ttlMs;
}

export function clearPlayerCommand(dataDir) {
  fs.rmSync(playerCommandPath(dataDir), { force: true });
}

/**
 * A zero exit is treated as the operator closing the app window. Non-zero exits
 * keep the running intent so the watchdog can recover an actual crash.
 */
export function desiredAfterBrowserExit({ intentional = false, desired = 'stopped', code = null } = {}) {
  if (intentional) return desired === 'running' ? 'running' : 'stopped';
  if (code === 0) return 'stopped';
  return desired === 'running' ? 'running' : 'stopped';
}
