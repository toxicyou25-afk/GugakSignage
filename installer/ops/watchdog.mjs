// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const installDir = path.resolve(import.meta.dirname, '..');
const configPath = path.join(installDir, 'install.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const watchdogConfig = {
  healthIntervalMs: 5000,
  browserCheckIntervalMs: 15000,
  startupGraceMs: 45000,
  serverBackoffInitialMs: 2000,
  serverBackoffMaxMs: 60000,
  browserBackoffInitialMs: 3000,
  browserBackoffMaxMs: 60000,
  circuitBreakerAfter: 8,
  circuitBreakerCooldownMs: 300000,
  stableResetMs: 60000,
  ...(config.watchdog || {}),
};

const logDir = path.resolve(config.logDir || path.join(config.dataDir, 'logs'));
const controlDir = path.join(config.dataDir, 'control');
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(controlDir, { recursive: true });

function rotateFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 5 * 1024 * 1024) return;
    const previous = filePath + '.1';
    fs.rmSync(previous, { force: true });
    fs.renameSync(filePath, previous);
  } catch {
    // Missing and inaccessible files are handled when the stream opens.
  }
}

const logPath = path.join(logDir, 'watchdog.log');
const serverStdoutPath = path.join(logDir, 'server.stdout.log');
const serverStderrPath = path.join(logDir, 'server.stderr.log');
rotateFile(logPath);
rotateFile(serverStdoutPath);
rotateFile(serverStderrPath);
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

function writeLog(level, message, details) {
  const suffix = details === undefined ? '' : ' ' + JSON.stringify(details);
  const line = new Date().toISOString() + ' [' + level + '] ' + message + suffix + '\n';
  logStream.write(line);
}

const lockPath = path.join(logDir, 'watchdog.lock');
try {
  const existingPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
  if (Number.isInteger(existingPid) && existingPid > 0) {
    try {
      process.kill(existingPid, 0);
      fs.appendFileSync(logPath, new Date().toISOString() + ' [INFO] watchdog already running ' + existingPid + '\n');
      process.exit(0);
    } catch {
      fs.rmSync(lockPath, { force: true });
    }
  }
} catch {
  // No existing lock.
}
fs.writeFileSync(lockPath, String(process.pid), 'utf8');

const stopRequestPath = path.join(controlDir, 'stop.request');
const statePath = path.join(logDir, 'watchdog-state.json');
let previousState = null;
try {
  previousState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch {
  // First start or an incomplete previous state file.
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
let lastServerHealthyAt = null;
let lastBrowserCheckAt = null;
let lastBrowserState = null;
let serverStdout = null;
let serverStderr = null;

function writeState() {
  const state = {
    watchdogPid: process.pid,
    serverPid: server?.pid ?? null,
    browserPid: browser?.pid ?? null,
    serverState: server ? 'running' : 'stopped',
    browserState: browser ? 'running' : 'stopped',
    serverStartedAt: serverStartedAt ? new Date(serverStartedAt).toISOString() : null,
    browserStartedAt: browserStartedAt ? new Date(browserStartedAt).toISOString() : null,
    lastServerHealthyAt,
    lastBrowserCheckAt,
    lastBrowserState,
    serverFailures,
    browserFailures,
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

function delayForFailures(count, initial, maximum) {
  if (count >= watchdogConfig.circuitBreakerAfter) {
    return watchdogConfig.circuitBreakerCooldownMs;
  }
  return Math.min(initial * (2 ** Math.max(0, count - 1)), maximum);
}

function clearTimer(timer) {
  if (timer) clearTimeout(timer);
}

async function killProcessTree(child) {
  if (!child?.pid) return;
  await new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(resolve, 8000);
    killer.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    killer.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function scheduleServerRestart(reason) {
  if (shuttingDown || serverRestartTimer) return;
  serverFailures += 1;
  const delayMs = delayForFailures(
    serverFailures,
    watchdogConfig.serverBackoffInitialMs,
    watchdogConfig.serverBackoffMaxMs,
  );
  writeLog('WARN', 'server restart scheduled', {
    reason,
    failures: serverFailures,
    delayMs,
    circuitBreaker: serverFailures >= watchdogConfig.circuitBreakerAfter,
  });
  writeState();
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    startServer('backoff');
  }, delayMs);
}

function scheduleBrowserRestart(reason) {
  if (shuttingDown || browserRestartTimer) return;
  browserFailures += 1;
  const delayMs = delayForFailures(
    browserFailures,
    watchdogConfig.browserBackoffInitialMs,
    watchdogConfig.browserBackoffMaxMs,
  );
  writeLog('WARN', 'browser restart scheduled', {
    reason,
    failures: browserFailures,
    delayMs,
    circuitBreaker: browserFailures >= watchdogConfig.circuitBreakerAfter,
  });
  writeState();
  browserRestartTimer = setTimeout(() => {
    browserRestartTimer = null;
    startBrowser('backoff');
  }, delayMs);
}

function startServer(reason) {
  if (shuttingDown || server || serverActionBusy) return;
  serverActionBusy = true;
  clearTimer(serverRestartTimer);
  serverRestartTimer = null;
  try {
    serverStdout = fs.createWriteStream(serverStdoutPath, { flags: 'a' });
    serverStderr = fs.createWriteStream(serverStderrPath, { flags: 'a' });
    const child = spawn(config.nodePath || process.execPath, [path.join(installDir, 'dist', 'server.js')], {
      cwd: installDir,
      env: {
        ...process.env,
        GUGAK_ENV_FILE: config.envFile,
        GUGAK_INSTALLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: true,
    });
    server = child;
    serverStartedAt = Date.now();
    serverHealthySince = 0;
    serverHealthMisses = 0;
    child.stdout.pipe(serverStdout);
    child.stderr.pipe(serverStderr);
    child.once('error', (error) => {
      writeLog('ERROR', 'server process error', { message: error.message });
      if (server === child) server = null;
      serverStdout?.end();
      serverStderr?.end();
      scheduleServerRestart('spawn-error');
    });
    child.once('exit', (code, signal) => {
      writeLog('WARN', 'server exited', { pid: child.pid, code, signal });
      if (server === child) server = null;
      serverStartedAt = 0;
      serverHealthySince = 0;
      serverStdout?.end();
      serverStderr?.end();
      serverStdout = null;
      serverStderr = null;
      writeState();
      if (!child.__watchdogIntentionalStop) scheduleServerRestart('process-exit');
    });
    writeLog('INFO', 'server started', { pid: child.pid, reason });
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
  writeLog('WARN', 'server health check failed; replacing process', { pid: child.pid, reason });
  await killProcessTree(child);
  serverStartedAt = 0;
  serverHealthySince = 0;
  serverHealthMisses = 0;
  serverActionBusy = false;
  scheduleServerRestart(reason);
}

async function startBrowser(reason) {
  if (shuttingDown || browser || browserActionBusy) return;
  browserActionBusy = true;
  clearTimer(browserRestartTimer);
  browserRestartTimer = null;
  try {
    const previousBrowserPid = Number(previousState?.browserPid || 0);
    if (previousBrowserPid > 0) {
      try {
        process.kill(previousBrowserPid, 0);
        await checkBrowserHealth();
        browser = { pid: previousBrowserPid, adopted: true };
        browserStartedAt = Date.parse(previousState?.browserStartedAt || '') || Date.now();
        browserHealthySince = Date.now();
        browserHealthMisses = 0;
        writeLog('INFO', 'existing browser adopted', { pid: previousBrowserPid, reason });
        writeState();
        return;
      } catch {
        // The old process or debugging endpoint is unavailable; start a new browser.
      }
    }
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
    if (isEdge) {
      args.push(
        '--app=' + config.playerUrl,
        '--start-fullscreen',
        '--disable-features=msEdgeFirstRunExperience',
        '--disable-session-crashed-bubble',
      );
    } else {
      args.push('--kiosk', '--start-fullscreen', config.playerUrl);
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
      scheduleBrowserRestart('spawn-error');
    });
    child.once('exit', (code, signal) => {
      writeLog('WARN', 'browser exited', { pid: child.pid, code, signal });
      if (browser === child) browser = null;
      browserStartedAt = 0;
      browserHealthySince = 0;
      writeState();
      if (!child.__watchdogIntentionalStop) scheduleBrowserRestart('process-exit');
    });
    writeLog('INFO', 'browser started', { pid: child.pid, reason, debugPort: config.debugPort });
    writeState();
  } catch (error) {
    writeLog('ERROR', 'browser start failed', { message: error.message });
    browser = null;
    scheduleBrowserRestart('start-exception');
  } finally {
    browserActionBusy = false;
  }
}

async function replaceBrowser(reason) {
  if (!browser || browserActionBusy || shuttingDown) return;
  browserActionBusy = true;
  const child = browser;
  child.__watchdogIntentionalStop = true;
  browser = null;
  writeLog('WARN', 'browser check failed; replacing process', { pid: child.pid, reason });
  await killProcessTree(child);
  browserStartedAt = 0;
  browserHealthySince = 0;
  browserHealthMisses = 0;
  browserActionBusy = false;
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
          expression: '({ playerReady: Boolean(window.__signagePlayer), state: window.__signagePlayer?.getState?.() || null, visibility: document.visibilityState })',
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

async function checkBrowserHealth() {
  const response = await fetch('http://127.0.0.1:' + config.debugPort + '/json/list', {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('CDP HTTP ' + response.status);
  const targets = await response.json();
  const playerBase = config.playerUrl.split('?')[0];
  const page = targets.find((target) =>
    target.type === 'page' && typeof target.url === 'string' && target.url.startsWith(playerBase),
  );
  if (!page?.webSocketDebuggerUrl) throw new Error('player target not found');
  const result = await evaluatePage(page.webSocketDebuggerUrl);
  if (!result?.playerReady) throw new Error('player runtime not ready');
  lastBrowserCheckAt = new Date().toISOString();
  lastBrowserState = result.state;
}

async function superviseServer() {
  if (!server || shuttingDown) return;
  try {
    await checkServerHealth();
    lastServerHealthyAt = new Date().toISOString();
    serverHealthMisses = 0;
    if (!serverHealthySince) serverHealthySince = Date.now();
    if (serverFailures > 0 && Date.now() - serverHealthySince >= watchdogConfig.stableResetMs) {
      writeLog('INFO', 'server stable; resetting backoff', { previousFailures: serverFailures });
      serverFailures = 0;
      writeState();
    }
  } catch (error) {
    serverHealthMisses += 1;
    writeLog('WARN', 'server health check failed', { message: error.message, misses: serverHealthMisses });
    const age = Date.now() - serverStartedAt;
    if (serverHealthMisses >= 3 && age >= watchdogConfig.startupGraceMs) {
      await replaceServer('health-check');
    }
  }
}

async function superviseBrowser() {
  if (!browser || shuttingDown) return;
  try {
    await checkBrowserHealth();
    browserHealthMisses = 0;
    if (!browserHealthySince) browserHealthySince = Date.now();
    if (browserFailures > 0 && Date.now() - browserHealthySince >= watchdogConfig.stableResetMs) {
      writeLog('INFO', 'browser stable; resetting backoff', { previousFailures: browserFailures });
      browserFailures = 0;
      writeState();
    }
  } catch (error) {
    browserHealthMisses += 1;
    writeLog('WARN', 'browser health check failed', { message: error.message, misses: browserHealthMisses });
    const age = Date.now() - browserStartedAt;
    if (browserHealthMisses >= 2 && age >= watchdogConfig.startupGraceMs) {
      await replaceBrowser('health-check');
    }
  }
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog('INFO', 'watchdog stopping', { reason });
  clearTimer(serverRestartTimer);
  clearTimer(browserRestartTimer);
  const currentServer = server;
  const currentBrowser = browser;
  if (currentServer) currentServer.__watchdogIntentionalStop = true;
  if (currentBrowser) currentBrowser.__watchdogIntentionalStop = true;
  await Promise.all([killProcessTree(currentServer), killProcessTree(currentBrowser)]);
  server = null;
  browser = null;
  fs.rmSync(stopRequestPath, { force: true });
  fs.rmSync(lockPath, { force: true });
  writeState();
  logStream.end();
  setTimeout(() => process.exit(0), 100);
}

startServer('startup');
void startBrowser('startup');

const serverTimer = setInterval(() => {
  if (!server && !serverRestartTimer && !shuttingDown) scheduleServerRestart('missing-process');
  void superviseServer();
}, watchdogConfig.healthIntervalMs);

const browserTimer = setInterval(() => {
  if (!browser && !browserRestartTimer && !shuttingDown) scheduleBrowserRestart('missing-process');
  void superviseBrowser();
}, watchdogConfig.browserCheckIntervalMs);

const controlTimer = setInterval(() => {
  if (fs.existsSync(stopRequestPath)) void shutdown('stop-request');
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
});
writeState();
