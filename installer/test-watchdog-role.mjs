// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveWatchdogHealthTarget, resolveWatchdogRole } from './ops/watchdog-role.mjs';
import * as watchdogRole from './ops/watchdog-role.mjs';
import { readScreenTargetAssignment, writePlayerState, writeScreenTargetAssignment } from './ops/player-state.mjs';

test('Manager LAN watchdog health trust includes system CA roots', () => {
  assert.equal(typeof watchdogRole.managerHealthCaCertificates, 'function');
  const trust = watchdogRole.managerHealthCaCertificates({
    rootCertificates: ['bundled-root'],
    getCACertificates: (type) => type === 'system' ? ['system-root', 'bundled-root'] : [],
  }, 'configured-manager-chain');
  assert.deepEqual(trust, ['bundled-root', 'system-root', 'configured-manager-chain']);
});

test('remote screen assignments persist atomically and an empty Manager result clears them', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-screen-assignment-'));
  try {
    const assigned = { deviceId: 'device-remote', screenTargets: [{ displayId: 'display-1', nativeMonitorId: 'MONITOR\\REMOTE-1' }] };
    writeScreenTargetAssignment(dataDir, assigned);
    assert.deepEqual(readScreenTargetAssignment(dataDir), assigned);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'control')), ['screen-targets.json']);
    writeScreenTargetAssignment(dataDir, { deviceId: 'device-remote', screenTargets: [] });
    assert.deepEqual(readScreenTargetAssignment(dataDir), { deviceId: 'device-remote', screenTargets: [] });
    assert.throws(() => writeScreenTargetAssignment(dataDir, {
      deviceId: 'device-remote', screenTargets: [{ displayId: 'bad', nativeMonitorId: 'not-a-monitor' }],
    }));
    assert.deepEqual(readScreenTargetAssignment(dataDir), { deviceId: 'device-remote', screenTargets: [] });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('non-Player Host watchdog roles ignore stale persisted remote screen assignments', async (t) => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-role-assignment-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const installDir = path.join(tempRoot, 'install');
  const dataDir = path.join(tempRoot, 'data');
  const opsDir = path.join(installDir, 'ops');
  fs.mkdirSync(opsDir, { recursive: true });
  for (const file of [
    'watchdog.mjs', 'watchdog-role.mjs', 'watchdog-health.mjs', 'admin-startup.mjs',
    'player-state.mjs', 'player-adoption.mjs', 'player-windows.mjs', 'cdp-websocket.mjs',
  ]) {
    fs.copyFileSync(path.join(repoRoot, 'installer', 'ops', file), path.join(opsDir, file));
  }
  const assignment = {
    deviceId: 'remote-player-host',
    screenTargets: [{ displayId: 'remote-display', nativeMonitorId: 'MONITOR\\REMOTE-1' }],
  };
  writeScreenTargetAssignment(dataDir, assignment);

  const roleCases = [
    { name: 'integrated', role: 'integrated', persistedPlayerUrl: 'http://127.0.0.1:43127/player/', expectedTargets: 0 },
    { name: 'manager', role: 'manager', persistedPlayerUrl: 'http://127.0.0.1:43127/player/', expectedTargets: 0 },
    { name: 'integrated-local-recovery', role: 'integrated', persistedPlayerUrl: 'http://127.0.0.1:1/player/', expectedTargets: 1 },
  ];
  for (const { name, role, persistedPlayerUrl, expectedTargets } of roleCases) {
    const roleInstallDir = path.join(tempRoot, name);
    fs.mkdirSync(path.join(roleInstallDir, 'ops'), { recursive: true });
    for (const file of fs.readdirSync(opsDir)) {
      fs.copyFileSync(path.join(opsDir, file), path.join(roleInstallDir, 'ops', file));
    }
    const roleDataDir = path.join(tempRoot, `${name}-data`);
    fs.mkdirSync(path.join(roleDataDir, 'control'), { recursive: true });
    fs.copyFileSync(path.join(dataDir, 'control', 'screen-targets.json'), path.join(roleDataDir, 'control', 'screen-targets.json'));
    writePlayerState(roleDataDir, {
      schemaVersion: 1, desired: 'stopped', running: false, pid: null, startedAt: null,
      deviceId: assignment.deviceId, playerUrl: persistedPlayerUrl,
      screenTargets: assignment.screenTargets, lastError: null, updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(path.join(roleInstallDir, 'install.json'), JSON.stringify({
      role, installDir: roleInstallDir, dataDir: roleDataDir, logDir: path.join(roleDataDir, 'logs'),
      nodePath: path.join(tempRoot, 'missing-node.exe'), browserPath: path.join(tempRoot, 'missing-browser.exe'),
      profileDir: path.join(tempRoot, 'profile'), playerUrl: 'http://127.0.0.1:1/player/',
      port: 1, debugPort: 2,
      watchdog: {
        healthIntervalMs: 20, browserCheckIntervalMs: 20, serverStartupGraceMs: 0,
        serverHealthFailureThreshold: 1, serverBackoffInitialMs: 10, serverBackoffMaxMs: 10,
        maxConsecutiveFailures: 1, logMaxBytes: 4096,
      },
    }));
    const child = spawn(process.execPath, [path.join(roleInstallDir, 'ops', 'watchdog.mjs')], {
      cwd: roleInstallDir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    let timeout;
    const exitCode = await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          child.kill();
          reject(new Error(`${role} watchdog did not stop: ${stderr}`));
        }, 5000);
      }),
    ]).finally(() => clearTimeout(timeout));
    assert.notEqual(exitCode, 0, `${role} watchdog should halt when its server cannot start`);
    const state = JSON.parse(fs.readFileSync(path.join(roleDataDir, 'logs', 'watchdog-state.json'), 'utf8'));
    assert.equal(state.screenTargetCount, expectedTargets, `${name} must retain only its role-appropriate targets`);
    const persistedPlayerState = JSON.parse(fs.readFileSync(path.join(roleDataDir, 'control', 'player-state.json'), 'utf8'));
    assert.deepEqual(persistedPlayerState.screenTargets, expectedTargets ? assignment.screenTargets : [],
      `${name} must preserve local recovery or retire copied Player Host targets`);
  }
});

test('Player Host exposes a local liveness health response independent of Manager', async () => {
  const { createPlayerHostServer } = await import(pathToFileURL(fileURLToPath(new URL('../src/player-host-server.ts', import.meta.url))).href);
  const host = createPlayerHostServer({
    managerUrl: 'http://127.0.0.1:1',
    credentialStore: { async readToken() { return null; }, async writeToken() {}, async clear() {} },
    identityStore: { async getOrCreateHardwareId() { return 'stable-host-id'; } },
    port: 0,
  });
  await host.start();
  try {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'gugak-player-host' });
  } finally {
    await host.close();
  }
});

test('legacy integrated installs retain the server health and player URL defaults', () => {
  assert.deepEqual(resolveWatchdogRole({ port: 3000, playerUrl: 'http://127.0.0.1:3000/player/' }), {
    role: 'integrated',
    serverEntry: 'server.js',
    healthService: 'gugak-signage',
    healthPort: 3000,
    playerUrl: 'http://127.0.0.1:3000/player/',
    playerAutoStart: false,
  });
});

test('Manager-only LAN installs keep the Manager service and never auto-start a local Player', () => {
  assert.deepEqual(resolveWatchdogRole({
    role: 'manager',
    port: 3443,
    playerUrl: 'http://127.0.0.1:3443/player/',
  }), {
    role: 'manager',
    serverEntry: 'server.js',
    healthService: 'gugak-signage',
    healthPort: 3443,
    playerUrl: 'http://127.0.0.1:3443/player/',
    playerAutoStart: false,
  });
});

test('Player Host installs use their loopback health and pairing page contract', () => {
  assert.deepEqual(resolveWatchdogRole({
    role: 'player-host',
    port: 3000,
    managerUrl: 'http://127.0.0.1:3000',
    playerUrl: 'http://127.0.0.1:43127/player/',
  }), {
    role: 'player-host',
    serverEntry: 'player-host-main.js',
    healthService: 'gugak-player-host',
    healthPort: 43127,
    playerUrl: 'http://127.0.0.1:43127/player/',
    managerUrl: 'http://127.0.0.1:3000/',
    managerCaFile: null,
    playerAutoStart: true,
  });
});

test('remote Player Host requires HTTPS and a readable PEM CA bundle', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-ca-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const caFile = path.join(directory, 'manager-ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n');
  const base = {
    role: 'player-host',
    playerUrl: 'http://127.0.0.1:43127/player/',
    managerUrl: 'https://manager.internal.test',
  };
  assert.throws(() => resolveWatchdogRole({ ...base, managerUrl: 'http://manager.internal.test' }), /HTTPS/);
  assert.throws(() => resolveWatchdogRole(base), /CA certificate/);
  assert.throws(() => resolveWatchdogRole({ ...base, managerCaFile: path.join(directory, 'missing.pem') }), /CA certificate/);
  const resolved = resolveWatchdogRole({ ...base, managerCaFile: caFile });
  assert.equal(resolved.managerUrl, 'https://manager.internal.test/');
  assert.equal(resolved.managerCaFile, path.resolve(caFile));
});

test('health target uses TLS only for LAN Manager, even after role changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-health-target-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const certificate = path.join(directory, 'manager.pem');
  fs.writeFileSync(certificate, '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n');
  const lan = {
    role: 'manager', mode: 'lan', port: 3443,
    managerBaseUrl: 'https://manager.internal.test:3443', tlsCertFile: certificate,
  };
  assert.deepEqual(resolveWatchdogHealthTarget(lan), {
    url: 'https://127.0.0.1:3443/api/health',
    servername: 'manager.internal.test',
    caFile: path.resolve(certificate),
  });
  assert.throws(() => resolveWatchdogHealthTarget({ ...lan, managerBaseUrl: 'http://manager.internal.test:3443' }), /HTTPS/);
  assert.throws(() => resolveWatchdogHealthTarget({ ...lan, tlsCertFile: '' }), /certificate/i);
  assert.deepEqual(resolveWatchdogHealthTarget({ ...lan, mode: 'standalone' }), {
    url: 'http://127.0.0.1:3443/api/health',
  });
  assert.deepEqual(resolveWatchdogHealthTarget({ role: 'integrated', port: 3000 }), {
    url: 'http://127.0.0.1:3000/api/health',
  });
  assert.deepEqual(resolveWatchdogHealthTarget({
    role: 'player-host', port: 3000, managerUrl: 'https://manager.internal.test', managerCaFile: certificate,
    playerUrl: 'http://127.0.0.1:43127/player/',
  }), { url: 'http://127.0.0.1:43127/api/health' });
});

test('role-specific overrides cannot redirect the watchdog to another executable or endpoint', () => {
  assert.throws(() => resolveWatchdogRole({
    role: 'player-host', serverEntry: 'server.js', playerUrl: 'http://127.0.0.1:43127/player/',
  }), /Invalid install health or entry configuration/);
  assert.throws(() => resolveWatchdogRole({
    role: 'player-host', healthPort: 3000, playerUrl: 'http://127.0.0.1:43127/player/',
  }), /Invalid install health or entry configuration/);
  assert.throws(() => resolveWatchdogRole({
    role: 'player-host', playerUrl: 'https://manager.example.test/player/',
  }), /Player Host URL must use http:\/\/127\.0\.0\.1:43127\/player\//);
  assert.throws(() => resolveWatchdogRole({ role: 'unknown', port: 3000 }), /Invalid install role/);
});
