// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'GugakSignage-watchdog-test-'));
const installDir = path.join(tempRoot, 'install');
const dataDir = path.join(tempRoot, 'data');
const logDir = path.join(dataDir, 'logs');
const opsDir = path.join(installDir, 'ops');

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  fs.mkdirSync(opsDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'installer', 'ops', 'watchdog.mjs'),
    path.join(opsDir, 'watchdog.mjs'),
  );
  fs.copyFileSync(
    path.join(repoRoot, 'installer', 'ops', 'watchdog-health.mjs'),
    path.join(opsDir, 'watchdog-health.mjs'),
  );
  fs.copyFileSync(
    path.join(repoRoot, 'installer', 'ops', 'admin-startup.mjs'),
    path.join(opsDir, 'admin-startup.mjs'),
  );
  fs.copyFileSync(
    path.join(repoRoot, 'installer', 'ops', 'player-state.mjs'),
    path.join(opsDir, 'player-state.mjs'),
  );
  fs.copyFileSync(
    path.join(repoRoot, 'installer', 'ops', 'player-adoption.mjs'),
    path.join(opsDir, 'player-adoption.mjs'),
  );
  const config = {
    installDir,
    dataDir,
    logDir,
    envFile: path.join(dataDir, '.env'),
    nodePath: path.join(tempRoot, 'missing-node.exe'),
    browserPath: path.join(tempRoot, 'missing-browser.exe'),
    profileDir: path.join(tempRoot, 'profile'),
    playerUrl: 'http://127.0.0.1:1/player/',
    port: 1,
    debugPort: 2,
    watchdog: {
      healthIntervalMs: 40,
      browserCheckIntervalMs: 40,
      serverStartupGraceMs: 20,
      browserStartupGraceMs: 20,
      serverHealthFailureThreshold: 1,
      browserHealthFailureThreshold: 1,
      serverBackoffInitialMs: 20,
      browserBackoffInitialMs: 20,
      serverBackoffMaxMs: 40,
      browserBackoffMaxMs: 40,
      maxConsecutiveFailures: 3,
      stableResetMs: 1000,
      logMaxBytes: 512,
    },
  };
  fs.writeFileSync(path.join(installDir, 'install.json'), JSON.stringify(config, null, 2), 'utf8');

  const child = spawn(process.execPath, [path.join(opsDir, 'watchdog.mjs')], {
    cwd: installDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const exit = await Promise.race([
    new Promise((resolve) => child.once('exit', (code) => resolve(code))),
    sleep(10_000).then(() => { throw new Error('watchdog halt timeout: ' + output); }),
  ]);

  const statePath = path.join(logDir, 'watchdog-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.halted, true);
  assert.ok(state.haltedReason);
  assert.equal(state.haltedComponent, 'server');
  assert.equal(state.serverPid, null);
  assert.equal(state.browserPid, null);
  const playerState = JSON.parse(fs.readFileSync(path.join(dataDir, 'control', 'player-state.json'), 'utf8'));
  assert.equal(playerState.desired, 'stopped');
  assert.equal(playerState.running, false);
  assert.equal(playerState.pid, null);
  assert.equal(fs.existsSync(path.join(logDir, 'watchdog.lock')), false);
  assert.notEqual(exit, 0);

  const watchdogLog = fs.readFileSync(path.join(logDir, 'watchdog.log'), 'utf8');
  assert.match(watchdogLog + fs.readFileSync(path.join(logDir, 'watchdog.log.1'), 'utf8'), /CRITICAL/);
  const updatedAt = state.updatedAt;
  await sleep(500);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).updatedAt, updatedAt);

  process.stdout.write(JSON.stringify({
    result: 'passed',
    exitCode: exit,
    haltedComponent: state.haltedComponent,
    haltedReason: state.haltedReason,
    logRotated: true,
    resumedWithoutManualRestart: false,
  }) + '\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
