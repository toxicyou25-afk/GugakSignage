// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createFullscreenPlayerWindows, selectPlayerHealthTargets } from './player-windows.mjs';
import { classifyPlayerState } from './watchdog-health.mjs';
import { openAdminOnStartup } from './admin-startup.mjs';
import { verifyAdoptedPlayerStillOwned, verifyPlayerProcessIdentity } from './player-adoption.mjs';
import {
  clearPlayerCommand,
  desiredAfterBrowserExit,
  isPlayerCommandCurrent,
  readPlayerCommand,
  readPlayerState,
  readServerInstance,
  writePlayerState as persistPlayerState,
} from './player-state.mjs';

const execFileAsync = promisify(execFile);

const installDir = path.resolve(import.meta.dirname, '..');
const configPath = path.join(installDir, 'install.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const configuredWatchdog = config.watchdog || {};
const watchdogConfig = {
  healthIntervalMs: 5000,
  browserCheckIntervalMs: 15000,
  serverStartupGraceMs: 120000,
  browserStartupGraceMs: 120000,
  browserTargetMissingGraceMs: 15000,
  serverHealthFailureThreshold: 5,
  browserHealthFailureThreshold: 3,
  serverHeartbeatMaxAgeMs: 90000,
  serverBackoffInitialMs: 2000,
  serverBackoffMaxMs: 60000,
  browserBackoffInitialMs: 3000,
  browserBackoffMaxMs: 60000,
  maxConsecutiveFailures: 8,
  stableResetMs: 60000,
  logMaxBytes: 5 * 1024 * 1024,
  ...configuredWatchdog,
};

const logDir = path.resolve(config.logDir || path.join(config.dataDir, 'logs'));
const controlDir = path.join(config.dataDir, 'control');
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(controlDir, { recursive: true });

const watchdogStartedAt = new Date(Date.now() - (process.uptime() * 1000)).toISOString();
const logPath = path.join(logDir, 'watchdog.log');
const serverStdoutPath = path.join(logDir, 'server.stdout.log');
const serverStderrPath = path.join(logDir, 'server.stderr.log');
const logSizes = new Map();

function rotateLog(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < watchdogConfig.logMaxBytes) {
      logSizes.set(filePath, stat.size);
      return;
    }
    const previous = filePath + '.1';
    fs.rmSync(previous, { force: true });
    try {
      fs.renameSync(filePath, previous);
    } catch {
      fs.truncateSync(filePath, 0);
    }
  } catch {
    // A missing log starts at size zero.
  }
  try {
    logSizes.set(filePath, fs.statSync(filePath).size);
  } catch {
    logSizes.set(filePath, 0);
  }
}

function appendRotating(filePath, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let size = logSizes.get(filePath);
  if (size === undefined) {
    try { size = fs.statSync(filePath).size; } catch { size = 0; }
  }
  if (size + buffer.length > watchdogConfig.logMaxBytes) {
    const previous = filePath + '.1';
    try { fs.rmSync(previous, { force: true }); } catch {}
    try {
      fs.renameSync(filePath, previous);
    } catch {
      try {
        fs.truncateSync(filePath, 0);
      } catch {
        return;
      }
    }
    size = 0;
  }
  fs.appendFileSync(filePath, buffer);
  logSizes.set(filePath, size + buffer.length);
}

rotateLog(logPath);
rotateLog(serverStdoutPath);
rotateLog(serverStderrPath);

function writeLog(level, message, details) {
  const suffix = details === undefined ? '' : ' ' + JSON.stringify(details);
  const line = new Date().toISOString() + ' [' + level + '] ' + message + suffix + '\n';
  try {
    appendRotating(logPath, line);
  } catch {
    // Logging failure must not terminate the supervisor.
  }
}

const lockPath = path.join(logDir, 'watchdog.lock');
try {
  const existingPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
  if (Number.isInteger(existingPid) && existingPid > 0) {
    try {
      process.kill(existingPid, 0);
      appendRotating(logPath, new Date().toISOString() + ' [INFO] watchdog already running ' + existingPid + '\n');
      process.exit(0);
    } catch {
      fs.rmSync(lockPath, { force: true });
    }
  }
} catch {
  // No previous lock.
}
fs.writeFileSync(lockPath, String(process.pid), 'utf8');

const stopRequestPath = path.join(controlDir, 'stop.request');
const statePath = path.join(logDir, 'watchdog-state.json');
const persistedPlayerState = readPlayerState(config.dataDir);
let previousState = null;
try {
  previousState = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  // First start or an incomplete state file.
}

let server = null;
let browser = null;
let serverStartedAt = 0;
let browserStartedAt = 0;
let serverHealthySince = 0;
let browserHealthySince = 0;
let serverHealthMisses = 0;
let browserHealthMisses = 0;
let serverFailures = 0;
let browserFailures = 0;
let serverRestartTimer = null;
let browserRestartTimer = null;
let serverActionBusy = false;
let browserActionBusy = false;
let shuttingDown = false;
let halted = false;
let haltedReason = null;
let haltedComponent = null;
let stoppedReason = null;
let lastServerHealthyAt = null;
let lastBrowserCheckAt = null;
let lastBrowserState = null;
let lastBrowserStateKind = null;
let lastBrowserResponsive = null;
let previousServerChecked = false;
const adminStartupState = { attempted: false };
let playerDesired = persistedPlayerState.desired === 'running' ? 'running' : 'stopped';
let playerDeviceId = persistedPlayerState.deviceId;
let playerUrl = persistedPlayerState.playerUrl || config.playerUrl;
let playerScreenTargets = persistedPlayerState.screenTargets || [];
let playerWindowSetupPending = playerScreenTargets.length > 0;
let lastScreenWindowCheckAt = 0;
let playerLastError = persistedPlayerState.lastError;
let playerLastExit = null;
let playerCommandBusy = false;
let currentServerInstanceId = null;

function writeState() {
  const state = {
    schemaVersion: 2,
    watchdogPid: process.pid,
    watchdogStartedAt,
    serverPid: server?.pid ?? null,
    browserPid: browser?.pid ?? null,
    serverState: server ? 'running' : 'stopped',
    browserState: browser ? 'running' : 'stopped',
    serverStartedAt: serverStartedAt ? new Date(serverStartedAt).toISOString() : null,
    browserStartedAt: browserStartedAt ? new Date(browserStartedAt).toISOString() : null,
    lastServerHealthyAt,
    lastBrowserCheckAt,
    lastBrowserState,
    lastBrowserStateKind,
    lastBrowserResponsive,
    playerDesired,
    playerDeviceId,
    playerUrl,
    screenTargetCount: playerScreenTargets.length,
    serverInstanceId: currentServerInstanceId,
    serverHealthMisses,
    browserHealthMisses,
    serverFailures,
    browserFailures,
    halted,
    haltedReason,
    haltedComponent,
    stoppedReason,
    updatedAt: new Date().toISOString(),
  };
  const temporary = statePath + '.tmp';
  try {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(temporary, json, 'utf8');
    try {
      fs.renameSync(temporary, statePath);
    } catch {
      fs.rmSync(statePath, { force: true });
      fs.renameSync(temporary, statePath);
    }
  } catch (error) {
    writeLog('WARN', 'state file write failed', { message: error.message });
  }
}

function writePlayerState() {
  try {
    persistPlayerState(config.dataDir, {
      schemaVersion: 1,
      desired: playerDesired,
      running: Boolean(browser && browserStartedAt),
      pid: browser?.pid ?? null,
      startedAt: browserStartedAt ? new Date(browserStartedAt).toISOString() : null,
      deviceId: playerDeviceId,
      playerUrl,
      screenTargets: playerScreenTargets,
      lastError: playerLastError,
      updatedAt: new Date().toISOString(),
      ...(playerLastExit ? { lastExit: playerLastExit } : {}),
    });
  } catch (error) {
    writeLog('WARN', 'player state write failed', { message: error.message });
  }
}

function delayForFailures(count, initial, maximum) {
  return Math.min(initial * (2 ** Math.max(0, count - 1)), maximum);
}

function clearTimer(timer) {
  if (timer) clearTimeout(timer);
}

function processIsAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function readWindowsProcessInfo(processId) {
  if (process.platform !== 'win32' || !Number.isInteger(processId) || processId <= 0) return null;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}"`,
    'if (-not $process) { exit 3 }',
    '$result = [ordered]@{ executablePath = [string]$process.ExecutablePath; commandLine = [string]$process.CommandLine; creationDate = ([DateTime]$process.CreationDate).ToUniversalTime().ToString("o") }',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const { stdout } = await execFileAsync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
    const output = String(stdout || '').replace(/^\uFEFF/, '').trim();
    return output ? JSON.parse(output) : null;
  } catch (error) {
    if (error?.code === 3) return null;
    throw error;
  }
}

async function readCdpTargets() {
  const response = await fetch(`http://127.0.0.1:${config.debugPort}/json/list`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}

let nativeMonitorModulePromise = null;

async function discoverPlayerMonitors() {
  nativeMonitorModulePromise ||= import(pathToFileURL(path.join(installDir, 'dist', 'native-monitors.js')).href);
  const module = await nativeMonitorModulePromise;
  return module.discoverNativeMonitors(process.platform, installDir);
}

function isPlayerPageTarget(target) {
  const playerBase = String(playerUrl || config.playerUrl).split('?')[0];
  return target?.type === 'page' && typeof target.url === 'string' && target.url.startsWith(playerBase);
}

function isFallbackPlayerTarget(target) {
  if (!isPlayerPageTarget(target)) return false;
  try { return !new URL(target.url).searchParams.has('display'); } catch { return false; }
}

async function readBrowserDebuggerUrl() {
  const response = await fetch(`http://127.0.0.1:${config.debugPort}/json/version`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('CDP version endpoint failed.');
  const value = await response.json();
  if (typeof value.webSocketDebuggerUrl !== 'string') throw new Error('CDP browser endpoint is missing.');
  return value.webSocketDebuggerUrl;
}

async function retainFallbackCanvas(existingTargets) {
  try {
    const pages = (existingTargets || await readCdpTargets()).filter(isPlayerPageTarget);
    const fallback = pages.find(isFallbackPlayerTarget);
    return await createFullscreenPlayerWindows({
      webSocketDebuggerUrl: await readBrowserDebuggerUrl(),
      basePlayerUrl: playerUrl || config.playerUrl,
      fallbackTargetId: fallback?.id || '',
      closeFallback: false,
      screenTargets: [],
      existingTargets: pages.map((target) => ({ id: target.id, url: target.url })),
    });
  } catch (error) {
    writeLog('WARN', 'fallback player canvas could not be reconciled', { message: error.message });
    return { success: false, error: 'fallback-canvas-reconcile-failed' };
  }
}

async function configurePlayerWindows(existingTargets) {
  if (!playerScreenTargets.length) {
    playerWindowSetupPending = false;
    return true;
  }
  lastScreenWindowCheckAt = Date.now();
  let discovered;
  try {
    discovered = await discoverPlayerMonitors();
  } catch (error) {
    await retainFallbackCanvas(existingTargets);
    playerWindowSetupPending = true;
    playerLastError = '실제 모니터 정보를 확인하지 못해 기본 화면으로 재생합니다.';
    writeLog('WARN', 'physical monitor lookup failed; retaining fallback player canvas', { message: error.message });
    writeState();
    writePlayerState();
    return false;
  }
  if (!discovered.supported || discovered.error) {
    await retainFallbackCanvas(existingTargets);
    playerWindowSetupPending = true;
    playerLastError = '실제 모니터 정보를 확인하지 못해 기본 화면으로 재생합니다.';
    writeLog('WARN', 'physical monitor lookup unavailable; retaining fallback player canvas');
    writeState();
    writePlayerState();
    return false;
  }
  const byId = new Map(discovered.monitors.filter((monitor) => monitor.bindingId).map((monitor) => [monitor.bindingId, monitor]));
  const targets = [];
  const missing = [];
  for (const assignment of playerScreenTargets) {
    const monitor = byId.get(assignment.nativeMonitorId);
    if (!monitor) {
      missing.push(assignment.displayId);
      continue;
    }
    targets.push({ ...assignment, bounds: monitor.bounds });
  }
  const complete = missing.length === 0 && targets.length === playerScreenTargets.length;
  const pages = (existingTargets || await readCdpTargets()).filter(isPlayerPageTarget);
  if (!complete || !targets.length) {
    const fallback = await retainFallbackCanvas(pages);
    playerWindowSetupPending = true;
    playerLastError = targets.length
      ? '일부 배정 모니터가 연결되지 않아 기본 화면으로 재생합니다.'
      : '배정된 모니터가 연결되지 않아 기본 화면으로 재생합니다.';
    writeLog(fallback.success ? 'WARN' : 'ERROR', 'physical monitor assignments are incomplete; using the fallback player canvas', {
      assignedDisplays: playerScreenTargets.length,
      connectedDisplays: targets.length,
    });
    writeState();
    writePlayerState();
    return false;
  }
  try {
    const fallback = pages.find(isFallbackPlayerTarget);
    const result = await createFullscreenPlayerWindows({
      webSocketDebuggerUrl: await readBrowserDebuggerUrl(),
      basePlayerUrl: playerUrl || config.playerUrl,
      fallbackTargetId: fallback?.id || '',
      closeFallback: false,
      screenTargets: targets,
      existingTargets: pages.map((target) => ({ id: target.id, url: target.url })),
    });
    if (!result.success) throw new Error(result.error || 'CDP window setup failed.');
    let ready = false;
    if (complete) {
      ready = await waitForPlayerDisplayTargets(targets, watchdogConfig.browserTargetMissingGraceMs);
      if (ready) {
        const refreshedPages = (await readCdpTargets()).filter(isPlayerPageTarget);
        const refreshedFallback = refreshedPages.find(isFallbackPlayerTarget);
        const finalized = await createFullscreenPlayerWindows({
          webSocketDebuggerUrl: await readBrowserDebuggerUrl(),
          basePlayerUrl: playerUrl || config.playerUrl,
          fallbackTargetId: refreshedFallback?.id || '',
          closeFallback: true,
          screenTargets: targets,
          existingTargets: refreshedPages.map((target) => ({ id: target.id, url: target.url })),
        });
        if (!finalized.success) throw new Error(finalized.error || 'CDP fallback close failed.');
      }
    }
    playerWindowSetupPending = !complete || !ready;
    playerLastError = complete && ready ? null : '모니터별 재생 창이 준비되지 않아 기본 화면을 유지합니다.';
    writeLog(complete ? 'INFO' : 'WARN', 'per-display player windows reconciled', {
      assignedDisplays: playerScreenTargets.length,
      connectedDisplays: targets.length,
      openedWindows: result.createdTargetIds.length,
      displaysReady: ready,
      fallbackCanvasRetained: !complete || !ready,
    });
    writeState();
    writePlayerState();
    return complete && ready;
  } catch (error) {
    await retainFallbackCanvas(existingTargets);
    playerWindowSetupPending = true;
    playerLastError = '모니터별 전체 화면을 만들지 못해 기본 화면으로 재생합니다.';
    writeLog('WARN', 'per-display player window setup failed; retaining fallback canvas', { message: error.message });
    writeState();
    writePlayerState();
    return false;
  }
}

let playerWindowReconcilePromise = null;
async function ensurePlayerWindows(existingTargets) {
  if (!playerScreenTargets.length) return;
  if (playerWindowReconcilePromise) return playerWindowReconcilePromise;
  const intervalMs = Number.isFinite(watchdogConfig.monitorCheckIntervalMs) ? watchdogConfig.monitorCheckIntervalMs : 30000;
  if (!playerWindowSetupPending && Date.now() - lastScreenWindowCheckAt < intervalMs) return;
  lastScreenWindowCheckAt = Date.now();
  playerWindowReconcilePromise = configurePlayerWindows(existingTargets).finally(() => {
    playerWindowReconcilePromise = null;
  });
  return playerWindowReconcilePromise;
}

function resetPlayerAdoption(reason) {
  playerDesired = 'stopped';
  playerDeviceId = null;
  browser = null;
  browserStartedAt = 0;
  browserHealthySince = 0;
  browserHealthMisses = 0;
  playerLastError = `저장된 재생기 PID를 채택하지 않았습니다: ${reason}`;
  writeState();
  writePlayerState();
}

async function adoptPersistedPlayerOnStartup() {
  if (playerDesired !== 'running') return;
  const pid = Number(persistedPlayerState.pid);
  const startedAt = persistedPlayerState.startedAt;
  const expectedPlayerUrl = persistedPlayerState.playerUrl || config.playerUrl;
  if (!processIsAlive(pid)) {
    resetPlayerAdoption('프로세스가 존재하지 않음');
    writeLog('WARN', 'persisted player PID is not alive; not starting it automatically', { pid });
    return;
  }

  let processInfo = null;
  let cdpTargets = null;
  let lookupError = null;
  try {
    processInfo = await readWindowsProcessInfo(pid);
  } catch (error) {
    lookupError = `process-query-failed:${error.message}`;
  }
  try {
    cdpTargets = await readCdpTargets();
  } catch (error) {
    lookupError = lookupError || `cdp-query-failed:${error.message}`;
  }
  const verification = verifyPlayerProcessIdentity({
    processInfo,
    cdpTargets,
    browserPath: config.browserPath,
    profileDir: config.profileDir,
    debugPort: config.debugPort,
    playerUrl: expectedPlayerUrl,
    startedAt,
  });
  if (lookupError) verification.reasons.push(lookupError);
  if (!verification.ok) {
    writeLog('WARN', 'persisted player PID failed ownership verification; refusing to adopt or stop it', {
      pid,
      reasons: verification.reasons,
    });
    resetPlayerAdoption(verification.reasons.join(', '));
    return;
  }

  browser = {
    pid,
    adopted: true,
    __identityExpectation: {
      browserPath: config.browserPath,
      profileDir: config.profileDir,
      debugPort: config.debugPort,
      playerUrl: expectedPlayerUrl,
      startedAt,
    },
  };
  browserStartedAt = Date.parse(startedAt || '') || Date.now();
  browserHealthySince = Date.now();
  browserHealthMisses = 0;
  playerUrl = expectedPlayerUrl;
  playerLastError = null;
  writeState();
  writePlayerState();
  writeLog('INFO', 'existing player adopted after ownership verification', { pid, deviceId: playerDeviceId });
}

function refreshCurrentServerInstance() {
  if (!server?.pid) return null;
  const instance = readServerInstance(config.dataDir);
  if (!instance || instance.pid !== server.pid) return null;
  const startedAt = Date.parse(instance.startedAt || '');
  if (Number.isFinite(startedAt) && serverStartedAt && startedAt < serverStartedAt - 30000) {
    return null;
  }
  currentServerInstanceId = instance.id;
  return currentServerInstanceId;
}

async function killProcessTree(child) {
  if (!child?.pid) return;
  if (child.adopted && child.__identityExpectation) {
    let processInfo = null;
    try {
      processInfo = await readWindowsProcessInfo(Number(child.pid));
    } catch (error) {
      const ownershipError = new Error(`adopted player identity re-check failed: ${error.message}`);
      ownershipError.code = 'PLAYER_IDENTITY_MISMATCH';
      throw ownershipError;
    }
    const verification = verifyAdoptedPlayerStillOwned({
      processInfo,
      ...child.__identityExpectation,
    });
    if (!verification.ok) {
      const ownershipError = new Error(`adopted player identity mismatch: ${verification.reasons.join(', ')}`);
      ownershipError.code = 'PLAYER_IDENTITY_MISMATCH';
      throw ownershipError;
    }
  }
  await new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    killer.stdout.on('data', (chunk) => { output += chunk.toString(); });
    killer.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const timer = setTimeout(() => {
      killer.kill();
      reject(new Error('taskkill timeout for PID ' + child.pid));
    }, 8000);
    killer.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && processIsAlive(child.pid)) {
        reject(new Error('taskkill failed for PID ' + child.pid + ': ' + output.trim()));
      } else {
        resolve();
      }
    });
    killer.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function haltWatchdog(component, reason) {
  if (shuttingDown || halted) return;
  halted = true;
  shuttingDown = true;
  haltedComponent = component;
  haltedReason = reason;
  stoppedReason = 'failure-threshold';
  writeLog('CRITICAL', 'watchdog automatic restart stopped', {
    component,
    reason,
    serverFailures,
    browserFailures,
    manualRecovery: 'set-autostart.ps1 -Restart',
  });
  clearTimer(serverRestartTimer);
  clearTimer(browserRestartTimer);
  const currentServer = server;
  const currentBrowser = browser;
  if (currentServer) currentServer.__watchdogIntentionalStop = true;
  if (currentBrowser) currentBrowser.__watchdogIntentionalStop = true;
  try {
    await Promise.all([killProcessTree(currentServer), killProcessTree(currentBrowser)]);
  } catch (error) {
    writeLog('ERROR', 'child cleanup failed while halting', { message: error.message });
  }
  server = null;
  browser = null;
  serverStartedAt = 0;
  browserStartedAt = 0;
  playerDesired = 'stopped';
  fs.rmSync(lockPath, { force: true });
  writeState();
  writePlayerState();
  setTimeout(() => process.exit(2), 100);
}

function scheduleServerRestart(reason) {
  if (shuttingDown || serverRestartTimer || halted) return;
  serverFailures += 1;
  if (serverFailures >= watchdogConfig.maxConsecutiveFailures) {
    void haltWatchdog('server', '연속 실패 한도 도달: ' + reason);
    return;
  }
  const delayMs = delayForFailures(serverFailures, watchdogConfig.serverBackoffInitialMs, watchdogConfig.serverBackoffMaxMs);
  writeLog('WARN', 'server restart scheduled', { reason, failures: serverFailures, delayMs });
  writeState();
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    void startServer('backoff');
  }, delayMs);
}

function scheduleBrowserRestart(reason) {
  if (shuttingDown || browserRestartTimer || halted || playerDesired !== 'running') return;
  browserFailures += 1;
  if (browserFailures >= watchdogConfig.maxConsecutiveFailures) {
    void haltWatchdog('browser', '연속 실패 한도 도달: ' + reason);
    return;
  }
  const delayMs = delayForFailures(browserFailures, watchdogConfig.browserBackoffInitialMs, watchdogConfig.browserBackoffMaxMs);
  writeLog('WARN', 'browser restart scheduled', { reason, failures: browserFailures, delayMs });
  writeState();
  browserRestartTimer = setTimeout(() => {
    browserRestartTimer = null;
    void startBrowser('backoff');
  }, delayMs);
}

async function adoptPreviousServer() {
  if (previousServerChecked) return false;
  previousServerChecked = true;
  const previousPid = Number(previousState?.serverPid || 0);
  if (!processIsAlive(previousPid)) return false;
  try {
    await checkServerHealth();
    server = { pid: previousPid, adopted: true };
    serverStartedAt = Date.parse(previousState?.serverStartedAt || '') || Date.now();
    serverHealthySince = Date.now();
    serverHealthMisses = 0;
    writeLog('INFO', 'existing server adopted', { pid: previousPid });
    writeState();
    return true;
  } catch {
    return false;
  }
}

async function startServer(reason) {
  if (shuttingDown || server || serverActionBusy || halted) return;
  serverActionBusy = true;
  currentServerInstanceId = null;
  clearTimer(serverRestartTimer);
  serverRestartTimer = null;
  try {
    if (await adoptPreviousServer()) return;
    const child = spawn(config.nodePath || process.execPath, [path.join(installDir, 'dist', 'server.js')], {
      cwd: installDir,
      env: {
        ...process.env,
        GUGAK_ENV_FILE: config.envFile,
        GUGAK_INSTALLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });
    server = child;
    serverStartedAt = Date.now();
    serverHealthySince = 0;
    serverHealthMisses = 0;
    child.stdout.on('data', (chunk) => {
      try { appendRotating(serverStdoutPath, chunk); } catch {}
    });
    child.stderr.on('data', (chunk) => {
      try { appendRotating(serverStderrPath, chunk); } catch {}
    });
    child.once('error', (error) => {
      writeLog('ERROR', 'server process error', { message: error.message });
      if (server === child) server = null;
      scheduleServerRestart('spawn-error');
    });
    child.once('exit', (code, signal) => {
      writeLog('WARN', 'server exited', { pid: child.pid, code, signal });
      if (server === child) server = null;
      currentServerInstanceId = null;
      serverStartedAt = 0;
      serverHealthySince = 0;
      writeState();
      if (!child.__watchdogIntentionalStop) scheduleServerRestart('process-exit');
    });
    writeLog('INFO', 'server started', { pid: child.pid, reason, detached: false });
    writeState();
  } catch (error) {
    writeLog('ERROR', 'server start failed', { message: error.message });
    server = null;
    scheduleServerRestart('start-exception');
  } finally {
    serverActionBusy = false;
  }
}

async function replaceServer(reason) {
  if (!server || serverActionBusy || shuttingDown) return;
  serverActionBusy = true;
  const child = server;
  child.__watchdogIntentionalStop = true;
  server = null;
  currentServerInstanceId = null;
  writeLog('WARN', 'server health check failed; replacing process', { pid: child.pid, reason });
  try {
    await killProcessTree(child);
  } catch (error) {
    writeLog('ERROR', 'server replacement kill failed', { message: error.message });
    await haltWatchdog('server', '프로세스 종료 실패');
    return;
  } finally {
    serverActionBusy = false;
  }
  serverStartedAt = 0;
  serverHealthySince = 0;
  serverHealthMisses = 0;
  scheduleServerRestart(reason);
}

async function startBrowser(reason) {
  if (shuttingDown || browser || browserActionBusy || halted) return;
  browserActionBusy = true;
  clearTimer(browserRestartTimer);
  browserRestartTimer = null;
  try {
    const browserName = path.basename(config.browserPath).toLowerCase();
    const isEdge = browserName === 'msedge.exe';
    const args = [
      '--user-data-dir=' + config.profileDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--overscroll-behavior=none',
      '--disable-pinch',
      '--disable-infobars',
      '--noerrdialogs',
      '--hide-scrollbars',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + config.debugPort,
    ];
    if (config.browserHeadless === true) {
      args.push('--headless=new', '--disable-gpu');
    }
    if (isEdge) {
      args.push(
        '--app=' + playerUrl,
        '--start-fullscreen',
        '--disable-features=msEdgeFirstRunExperience',
        '--disable-session-crashed-bubble',
      );
    } else {
      args.push('--kiosk', '--start-fullscreen', playerUrl);
    }
    const child = spawn(config.browserPath, args, {
      cwd: installDir,
      stdio: 'ignore',
      windowsHide: false,
      detached: true,
    });
    browser = child;
    browserStartedAt = Date.now();
    browserHealthySince = 0;
    browserHealthMisses = 0;
    child.once('error', (error) => {
      writeLog('ERROR', 'browser process error', { message: error.message });
      if (browser === child) browser = null;
      browserStartedAt = 0;
      browserHealthySince = 0;
      playerLastError = '재생기 실행에 실패했습니다: ' + error.message;
      if (reason === 'admin-request' || reason === 'admin-switch') {
        playerDesired = 'stopped';
        writeState();
        writePlayerState();
      } else {
        scheduleBrowserRestart('spawn-error');
      }
    });
    child.once('exit', (code, signal) => {
      writeLog('WARN', 'browser exited', { pid: child.pid, code, signal });
      if (browser === child) browser = null;
      browserStartedAt = 0;
      browserHealthySince = 0;
      browserHealthMisses = 0;
      playerLastExit = { code, signal, at: new Date().toISOString() };
      const nextDesired = desiredAfterBrowserExit({
        intentional: Boolean(child.__watchdogIntentionalStop),
        desired: playerDesired,
        code,
      });
      if (!child.__watchdogIntentionalStop && nextDesired === 'stopped') {
        playerDesired = 'stopped';
        playerLastError = '재생기 창이 닫혀 실행을 중지했습니다.';
        writeLog('INFO', 'player window closed by user; keeping it stopped', { pid: child.pid });
        writeState();
        writePlayerState();
        return;
      }
      playerDesired = nextDesired;
      writeState();
      writePlayerState();
      if (!child.__watchdogIntentionalStop) scheduleBrowserRestart('process-exit');
    });
    writeLog('INFO', 'browser started', {
      pid: child.pid,
      reason,
      debugPort: config.debugPort,
      detached: true,
      headless: config.browserHeadless === true,
    });
    writeState();
    writePlayerState();
    if (playerScreenTargets.length) await ensurePlayerWindows();
  } catch (error) {
    writeLog('ERROR', 'browser start failed', { message: error.message });
    browser = null;
    browserStartedAt = 0;
    playerLastError = '재생기 실행에 실패했습니다: ' + error.message;
    if (reason === 'admin-request' || reason === 'admin-switch') playerDesired = 'stopped';
    else scheduleBrowserRestart('start-exception');
    writeState();
    writePlayerState();
  } finally {
    browserActionBusy = false;
  }
}

async function stopBrowser(reason, markStopped = true) {
  clearTimer(browserRestartTimer);
  browserRestartTimer = null;
  const child = browser;
  if (markStopped) playerDesired = 'stopped';
  if (child) {
    child.__watchdogIntentionalStop = true;
    browser = null;
    try {
      await killProcessTree(child);
    } catch (error) {
      writeLog('ERROR', 'browser stop failed', { message: error.message });
      playerLastError = '재생기 종료에 실패했습니다: ' + error.message;
    }
  }
  browserStartedAt = 0;
  browserHealthySince = 0;
  browserHealthMisses = 0;
  writeState();
  writePlayerState();
  writeLog('INFO', 'player stopped', { reason });
}

async function handlePlayerCommand() {
  if (playerCommandBusy || browserActionBusy || shuttingDown) return;
  const command = readPlayerCommand(config.dataDir);
  if (!command) return;
  const serverInstanceId = refreshCurrentServerInstance();
  if (!serverInstanceId) return;
  if (!isPlayerCommandCurrent(command, { serverInstanceId })) {
    clearPlayerCommand(config.dataDir);
    writeLog('WARN', 'stale player command ignored and removed', {
      commandId: command.id,
      commandInstanceId: command.serverInstanceId || null,
      currentServerInstanceId: serverInstanceId,
      requestedAt: command.requestedAt || null,
    });
    return;
  }
  playerCommandBusy = true;
  clearPlayerCommand(config.dataDir);
  try {
    if (command.action === 'stop') {
      playerScreenTargets = [];
      playerWindowSetupPending = false;
      await stopBrowser('admin-request');
      return;
    }
    let requestedUrl;
    try {
      requestedUrl = new URL(String(command.playerUrl || ''));
    } catch {
      requestedUrl = null;
    }
    if (!requestedUrl || requestedUrl.protocol !== 'http:' || requestedUrl.hostname !== '127.0.0.1' ||
        !requestedUrl.pathname.startsWith('/player')) {
      playerLastError = '재생기 실행 요청의 주소가 올바르지 않습니다.';
      playerDesired = 'stopped';
      playerScreenTargets = [];
      playerWindowSetupPending = false;
      writeState();
      writePlayerState();
      return;
    }
    const samePlayer = Boolean(
      browser && playerDeviceId === String(command.deviceId || '') && playerUrl === requestedUrl.toString() &&
        JSON.stringify(playerScreenTargets) === JSON.stringify(command.screenTargets || []),
    );
    if (samePlayer) {
      playerDesired = 'running';
      writeState();
      writePlayerState();
      return;
    }
    if (browser) await stopBrowser('admin-switch', false);
    playerDesired = 'running';
    playerDeviceId = typeof command.deviceId === 'string' ? command.deviceId : null;
    playerUrl = requestedUrl.toString();
    playerScreenTargets = Array.isArray(command.screenTargets) ? command.screenTargets : [];
    playerWindowSetupPending = playerScreenTargets.length > 0;
    lastScreenWindowCheckAt = 0;
    playerLastError = null;
    playerLastExit = null;
    browserFailures = 0;
    writeState();
    writePlayerState();
    await startBrowser('admin-request');
  } finally {
    playerCommandBusy = false;
  }
}

async function replaceBrowser(reason) {
  if (!browser || browserActionBusy || shuttingDown || playerDesired !== 'running') return;
  browserActionBusy = true;
  const child = browser;
  child.__watchdogIntentionalStop = true;
  browser = null;
  writeLog('WARN', 'browser check failed; replacing process', { pid: child.pid, reason });
  try {
    await killProcessTree(child);
  } catch (error) {
    writeLog('ERROR', 'browser replacement kill failed', { message: error.message });
    if (error.code === 'PLAYER_IDENTITY_MISMATCH') {
      playerDesired = 'stopped';
      playerLastError = '채택한 재생기 프로세스의 소유권이 바뀌어 종료하지 않았습니다.';
      browser = null;
      browserStartedAt = 0;
      browserHealthySince = 0;
      writeState();
      writePlayerState();
      return;
    }
    await haltWatchdog('browser', '프로세스 종료 실패');
    return;
  } finally {
    browserActionBusy = false;
  }
  browserStartedAt = 0;
  browserHealthySince = 0;
  browserHealthMisses = 0;
  writeState();
  writePlayerState();
  scheduleBrowserRestart(reason);
}

async function checkServerHealth() {
  const response = await fetch('http://127.0.0.1:' + config.port + '/api/health', {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (!data.ok || data.service !== 'gugak-signage') throw new Error('unexpected health payload');
}

async function evaluatePage(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('CDP evaluation timeout'));
    }, 4000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: '({ playerReady: Boolean(window.__signagePlayer), state: window.__signagePlayer?.getState?.() || null, visibility: document.visibilityState, now: Date.now() })',
          returnByValue: true,
        },
      }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) {
          finish(new Error('CDP evaluation failed'));
          return;
        }
        finish(null, message.result?.result?.value || null);
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener('error', () => finish(new Error('CDP connection failed')), { once: true });
  });
}

async function waitForPlayerDisplayTargets(screenTargets, timeoutMs = 15000) {
  if (!screenTargets.length) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pages = (await readCdpTargets()).filter(isPlayerPageTarget);
      const targetByDisplay = new Map();
      for (const page of pages) {
        try {
          const displayId = new URL(page.url).searchParams.get('display');
          if (displayId && page.webSocketDebuggerUrl) targetByDisplay.set(displayId, page);
        } catch { /* ignore malformed browser target URLs */ }
      }
      if (screenTargets.every((target) => targetByDisplay.has(target.displayId))) {
        const states = await Promise.all(screenTargets.map((target) =>
          evaluatePage(targetByDisplay.get(target.displayId).webSocketDebuggerUrl).catch(() => null),
        ));
        const allReady = states.every((result, index) =>
          result?.playerReady === true && Array.isArray(result.state?.wallDisplayIds) &&
          result.state.wallDisplayIds.includes(screenTargets[index].displayId),
        );
        if (allReady) return true;
      }
    } catch { /* browser may still be starting; retry until the bounded deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function checkBrowserHealth() {
  let targets = await readCdpTargets();
  await ensurePlayerWindows(targets);
  targets = await readCdpTargets();
  const playerPages = targets.filter(isPlayerPageTarget);
  if (!playerPages.length) throw new Error('player target not found');
  const healthTargets = selectPlayerHealthTargets(
    playerPages,
    playerScreenTargets.map((target) => target.displayId),
  );
  if (playerScreenTargets.length > 0 && !healthTargets.allAssigned) playerWindowSetupPending = true;
  if (!healthTargets.pages.length) throw new Error('no responsive player targets found');
  const pagesToCheck = healthTargets.pages;
  const results = await Promise.all(pagesToCheck.map((page) => evaluatePage(page.webSocketDebuggerUrl)));
  const classifications = results.map((result) => classifyPlayerState(result, watchdogConfig.serverHeartbeatMaxAgeMs));
  const classification = classifications.find((item) => item.actionable) ||
    classifications.find((item) => !item.healthy) || classifications[0];
  const result = results[classifications.indexOf(classification)];
  lastBrowserCheckAt = new Date().toISOString();
  lastBrowserState = result?.state || null;
  lastBrowserStateKind = classification.kind;
  lastBrowserResponsive = classification.responsive;
  return classification;
}

async function superviseServer() {
  if (!server || shuttingDown) return;
  try {
    await checkServerHealth();
    lastServerHealthyAt = new Date().toISOString();
    serverHealthMisses = 0;
    if (!serverHealthySince) serverHealthySince = Date.now();
    const instanceBefore = currentServerInstanceId;
    const instanceId = refreshCurrentServerInstance();
    if (instanceId && instanceId !== instanceBefore) {
      writeLog('INFO', 'current server instance recorded', { serverPid: server?.pid, serverInstanceId: instanceId });
    }
    if (!adminStartupState.attempted) {
      void openAdminOnStartup({
        config,
        port: config.port,
        installDir,
        state: adminStartupState,
      }).then((result) => {
        writeLog('INFO', 'admin startup decision', result);
      }).catch((error) => {
        writeLog('WARN', 'admin startup decision failed', { message: error.message });
      });
    }
    if (serverFailures > 0 && Date.now() - serverHealthySince >= watchdogConfig.stableResetMs) {
      writeLog('INFO', 'server stable; resetting restart failures', { previousFailures: serverFailures });
      serverFailures = 0;
      writeState();
    }
  } catch (error) {
    serverHealthMisses += 1;
    writeLog('WARN', 'server health check failed', { message: error.message, misses: serverHealthMisses, threshold: watchdogConfig.serverHealthFailureThreshold });
    const age = Date.now() - serverStartedAt;
    if (serverHealthMisses >= watchdogConfig.serverHealthFailureThreshold && age >= watchdogConfig.serverStartupGraceMs) {
      await replaceServer('health-check');
    }
  }
}

async function superviseBrowser() {
  if (!browser || shuttingDown) return;
  try {
    const health = await checkBrowserHealth();
    if (health.healthy) {
      browserHealthMisses = 0;
      if (!browserHealthySince) browserHealthySince = Date.now();
      if (browserFailures > 0 && Date.now() - browserHealthySince >= watchdogConfig.stableResetMs) {
        writeLog('INFO', 'browser stable; resetting restart failures', { previousFailures: browserFailures });
        browserFailures = 0;
      }
      writeState();
      return;
    }
    if (health.responsive && !health.actionable) {
      browserHealthMisses = 0;
      browserHealthySince = 0;
      writeLog('WARN', 'browser is responsive but not showing active playback', { stateKind: health.kind });
      writeState();
      return;
    }
    browserHealthMisses += 1;
    const age = Date.now() - browserStartedAt;
    writeLog('WARN', 'browser playback health check failed', {
      stateKind: health.kind,
      misses: browserHealthMisses,
      threshold: watchdogConfig.browserHealthFailureThreshold,
    });
    if (browserHealthMisses >= watchdogConfig.browserHealthFailureThreshold && age >= watchdogConfig.browserStartupGraceMs) {
      await replaceBrowser('playback-health-check');
    }
  } catch (error) {
    browserHealthMisses += 1;
    const age = Date.now() - browserStartedAt;
    writeLog('WARN', 'browser CDP health check failed', { message: error.message, misses: browserHealthMisses });
    if (error.message === 'player target not found' && age >= watchdogConfig.browserTargetMissingGraceMs) {
      playerLastError = '재생기 페이지가 닫혀 실행을 중지했습니다.';
      await stopBrowser('player-target-missing');
      return;
    }
    if (browserHealthMisses >= watchdogConfig.browserHealthFailureThreshold && age >= watchdogConfig.browserStartupGraceMs) {
      await replaceBrowser('cdp-health-check');
    }
  }
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  stoppedReason = reason;
  writeLog('INFO', 'watchdog stopping', { reason });
  clearTimer(serverRestartTimer);
  clearTimer(browserRestartTimer);
  const currentServer = server;
  const currentBrowser = browser;
  playerDesired = 'stopped';
  if (currentServer) currentServer.__watchdogIntentionalStop = true;
  if (currentBrowser) currentBrowser.__watchdogIntentionalStop = true;
  try {
    await Promise.all([killProcessTree(currentServer), killProcessTree(currentBrowser)]);
  } catch (error) {
    writeLog('ERROR', 'child cleanup failed while stopping', { message: error.message });
  }
  server = null;
  browser = null;
  fs.rmSync(stopRequestPath, { force: true });
  fs.rmSync(lockPath, { force: true });
  writeState();
  writePlayerState();
  setTimeout(() => process.exit(0), 100);
}

void startServer('startup');
await adoptPersistedPlayerOnStartup();

const serverTimer = setInterval(() => {
  if (!server && !serverRestartTimer && !shuttingDown) scheduleServerRestart('missing-process');
  void superviseServer();
}, watchdogConfig.healthIntervalMs);

const browserTimer = setInterval(() => {
  if (playerDesired === 'running' && !browser && !browserRestartTimer && !shuttingDown) {
    scheduleBrowserRestart('missing-process');
  }
  void superviseBrowser();
}, watchdogConfig.browserCheckIntervalMs);

const controlTimer = setInterval(() => {
  if (fs.existsSync(stopRequestPath)) void shutdown('stop-request');
  void handlePlayerCommand();
}, 1000);

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('uncaughtException', (error) => {
  writeLog('ERROR', 'uncaught exception', { message: error.message, stack: error.stack });
  void shutdown('uncaught-exception');
});
process.once('unhandledRejection', (error) => {
  writeLog('ERROR', 'unhandled rejection', { message: String(error) });
});
process.once('exit', () => {
  clearInterval(serverTimer);
  clearInterval(browserTimer);
  clearInterval(controlTimer);
});

writeLog('INFO', 'watchdog started', {
  pid: process.pid,
  installDir,
  dataDir: config.dataDir,
  port: config.port,
  manualRestartAfterHalt: Boolean(previousState?.halted),
});
writeState();
writePlayerState();
