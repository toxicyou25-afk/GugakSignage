// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveWatchdogRole } from './ops/watchdog-role.mjs';
import { readScreenTargetAssignment, writeScreenTargetAssignment } from './ops/player-state.mjs';

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
