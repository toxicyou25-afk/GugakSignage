// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

export function screenTargetAssignmentPath(dataDir) {
  return path.join(controlDir(dataDir), 'screen-targets.json');
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
    screenTargets: [],
    lastError: null,
    updatedAt: null,
  };
}

export function normalizeScreenTargets(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const targets = [];
  const displayIds = new Set();
  const monitorIds = new Set();
  for (const rawTarget of value) {
    if (!rawTarget || typeof rawTarget !== 'object') return [];
    const displayId = typeof rawTarget.displayId === 'string' ? rawTarget.displayId.trim() : '';
    const nativeMonitorId = typeof rawTarget.nativeMonitorId === 'string' ? rawTarget.nativeMonitorId.trim() : '';
    if (!displayId || displayId.length > 100 || !nativeMonitorId || nativeMonitorId.length > 512 || !/^MONITOR\\/iu.test(nativeMonitorId) ||
        displayIds.has(displayId) || monitorIds.has(nativeMonitorId)) return [];
    let bounds;
    if (rawTarget.bounds !== undefined) {
      if (!rawTarget.bounds || typeof rawTarget.bounds !== 'object') return [];
      const { x, y, width, height } = rawTarget.bounds;
      if (![x, y, width, height].every(Number.isSafeInteger) ||
          width < 320 || height < 320 || width > 16384 || height > 16384) return [];
      bounds = { x, y, width, height };
    }
    displayIds.add(displayId);
    monitorIds.add(nativeMonitorId);
    targets.push({ displayId, nativeMonitorId, ...(bounds ? { bounds } : {}) });
  }
  return targets;
}

export function readScreenTargetAssignment(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(screenTargetAssignmentPath(dataDir), 'utf8').replace(/^\uFEFF/, ''));
    if (typeof value?.deviceId !== 'string' || !value.deviceId || !Array.isArray(value.screenTargets)) return null;
    const screenTargets = normalizeScreenTargets(value.screenTargets);
    if (screenTargets.length !== value.screenTargets.length) return null;
    return { deviceId: value.deviceId, screenTargets };
  } catch {
    return null;
  }
}

export function writeScreenTargetAssignment(dataDir, assignment) {
  if (!assignment || typeof assignment.deviceId !== 'string' || !assignment.deviceId || !Array.isArray(assignment.screenTargets)) {
    throw new Error('Invalid screen target assignment.');
  }
  const screenTargets = normalizeScreenTargets(assignment.screenTargets);
  if (screenTargets.length !== assignment.screenTargets.length) throw new Error('Invalid screen target assignment.');
  fs.mkdirSync(controlDir(dataDir), { recursive: true });
  const filePath = screenTargetAssignmentPath(dataDir);
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify({ deviceId: assignment.deviceId, screenTargets }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
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
      screenTargets: normalizeScreenTargets(value?.screenTargets),
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
    return { ...value, screenTargets: normalizeScreenTargets(value.screenTargets) };
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
