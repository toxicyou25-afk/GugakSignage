// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function processCreationDate(pid) {
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if (-not $p) { exit 3 }; ([DateTime]$p.CreationDate).ToUniversalTime().ToString("o")`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 6000,
  });
  return stdout.trim();
}

test('무관한 장기 실행 PID는 채택하지 않고 종료하지 않는다', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'GugakSignage-adoption-test-'));
  const installDir = path.join(tempRoot, 'install');
  const dataDir = path.join(tempRoot, 'data');
  const logDir = path.join(dataDir, 'logs');
  const opsDir = path.join(installDir, 'ops');
  fs.mkdirSync(opsDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  for (const file of [
    'watchdog.mjs', 'watchdog-role.mjs', 'watchdog-health.mjs', 'admin-startup.mjs', 'player-state.mjs',
    'player-adoption.mjs', 'player-windows.mjs', 'cdp-websocket.mjs',
  ]) {
    fs.copyFileSync(path.join(repoRoot, 'installer', 'ops', file), path.join(opsDir, file));
  }

  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  let watchdog = null;
  let watchdogOutput = '';
  try {
    assert.ok(unrelated.pid);
    const startedAt = await processCreationDate(unrelated.pid);
    const playerUrl = 'http://127.0.0.1:1/player/?code=GUGAK1&reconnect=1';
    fs.mkdirSync(path.join(dataDir, 'control'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'control', 'player-state.json'), JSON.stringify({
      schemaVersion: 1,
      desired: 'running',
      running: true,
      pid: unrelated.pid,
      startedAt,
      deviceId: 'fake-device',
      playerUrl,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(installDir, 'install.json'), JSON.stringify({
      schemaVersion: 2,
      installDir,
      dataDir,
      logDir,
      nodePath: process.execPath,
      browserPath: process.execPath,
      profileDir: path.join(tempRoot, 'player-profile'),
      playerUrl,
      port: 1,
      debugPort: 2,
      browserHeadless: true,
      adminAutoOpen: { enabled: false },
      watchdog: {
        healthIntervalMs: 80,
        browserCheckIntervalMs: 80,
        serverStartupGraceMs: 1000,
        browserStartupGraceMs: 1000,
        browserTargetMissingGraceMs: 1000,
        serverHealthFailureThreshold: 20,
        browserHealthFailureThreshold: 20,
        maxConsecutiveFailures: 20,
        logMaxBytes: 1024 * 1024,
      },
    }, null, 2), 'utf8');

    watchdog = spawn(process.execPath, [path.join(opsDir, 'watchdog.mjs')], {
      cwd: installDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    watchdog.stdout.on('data', (chunk) => { watchdogOutput += chunk.toString(); });
    watchdog.stderr.on('data', (chunk) => { watchdogOutput += chunk.toString(); });

    const statePath = path.join(dataDir, 'control', 'player-state.json');
    const deadline = Date.now() + 12000;
    let state = null;
    while (Date.now() < deadline) {
      try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { }
      if (state?.desired === 'stopped' && state?.running === false) break;
      await sleep(100);
    }
    assert.equal(state?.desired, 'stopped', watchdogOutput);
    assert.equal(state?.running, false);
    assert.equal(state?.pid, null);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0), 'unrelated process was terminated');
    const log = fs.readFileSync(path.join(logDir, 'watchdog.log'), 'utf8');
    assert.match(log, /ownership verification/);
  } finally {
    try { watchdog?.kill(); } catch { }
    try { unrelated.kill(); } catch { }
    await sleep(300);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
  }
});
