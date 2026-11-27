/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import test from 'node:test';
import type { PlayerCredentialStore } from '../src/player-credentials.js';
import { createPlayerHostApp } from '../src/player-host.js';

const token = 'a'.repeat(64);
const identityStore = { async getOrCreateHardwareId() { return 'stable-host-id'; } };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function statusWithHeaders(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

function credentials(initial: string | null = null) {
  let value = initial;
  const store: PlayerCredentialStore = {
    async readToken() { return value; },
    async writeToken(next) { value = next; },
    async clear() { value = null; },
  };
  return { store, current: () => value };
}

test('registration persists the Player token before Manager commit and never returns it to the renderer', async (t) => {
  let managerAuthorization: string | null = null;
  let managerBody: Record<string, unknown> = {};
  let tokenPersistedBeforeManagerRequest: string | null = null;
  const creds = credentials();
  const manager = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      managerAuthorization = req.headers.authorization ?? null;
      assert.equal(req.url, '/api/player/register');
      managerBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      tokenPersistedBeforeManagerRequest = creds.current();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ token: managerBody.playerToken, device: { id: 'device-1' } }));
    });
  });
  const managerUrl = await listen(manager);
  const host = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore });
  const hostServer = host.listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  const response = await fetch(`${hostUrl}/api/player/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'GUGAK1', hardwareId: 'hardware-123', screen: { width: 1920, height: 1080 } }),
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(creds.current(), managerBody.playerToken);
  assert.equal(managerBody.playerToken, tokenPersistedBeforeManagerRequest);
  assert.match(String(managerBody.playerToken), /^[a-f0-9]{64}$/);
  assert.equal(managerAuthorization, null);
  assert.equal(managerBody.hardwareId, 'stable-host-id');
  assert.notEqual(managerBody.hardwareId, 'hardware-123');
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.deepEqual(body.device, { id: 'device-1' });
});

test('registration reuses a token for the same pairing code and rotates it for another device', async (t) => {
  const playerTokens: string[] = [];
  const tokenHashesByDevice = new Map<string, string>();
  let managerRequests = 0;
  const manager = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      managerRequests += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { playerToken: string };
      playerTokens.push(body.playerToken);
      if (managerRequests === 1) { res.destroy(); return; }
      res.setHeader('content-type', 'application/json');
      const deviceId = `device-${playerTokens.length}`;
      tokenHashesByDevice.set(deviceId, createHash('sha256').update(body.playerToken).digest('hex'));
      res.end(JSON.stringify({ token: body.playerToken, device: { id: deviceId } }));
    });
  });
  const managerUrl = await listen(manager);
  const creds = credentials(token);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const register = async (code: string) => fetch(`${hostUrl}/api/player/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });

  const lostResponseStatus = await register('DEVICE-A').then((response) => response.status, () => 0);
  assert.ok(lostResponseStatus === 0 || lostResponseStatus === 502);
  const retryToken = playerTokens[0];
  assert.match(retryToken ?? '', /^[a-f0-9]{64}$/);
  assert.equal((await register('DEVICE-A')).status, 200);
  assert.equal(playerTokens[1], retryToken);
  assert.equal((await register('DEVICE-A')).status, 200);
  assert.equal(playerTokens[2], retryToken);
  assert.equal((await register('DEVICE-B')).status, 200);
  assert.notEqual(playerTokens[3], retryToken);
  assert.notEqual(tokenHashesByDevice.get('device-2'), tokenHashesByDevice.get('device-4'));
  assert.equal(creds.current(), playerTokens[3]);
});

test('simultaneous registration requests for one pairing code share one Manager commit', async (t) => {
  let managerRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = createServer(async (req, res) => {
    managerRequests += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    await gate;
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { playerToken: string };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token: body.playerToken, device: { id: 'device-shared' } }));
  });
  const managerUrl = await listen(manager);
  const creds = credentials();
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { release(); await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const register = () => fetch(`${hostUrl}/api/player/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'SAME-CODE' }),
  });
  const first = register();
  while (managerRequests === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = register();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(managerRequests, 1);
  assert.match(creds.current() ?? '', /^[a-f0-9]{64}$/);
  for (const response of responses) assert.equal(JSON.stringify(await response.json()).includes('playerToken'), false);
});

test('an upstream stream failure does not prevent a later healthy Player Host request', async (t) => {
  let truncate = true;
  const manager = createServer((_req, res) => {
    if (truncate) {
      res.writeHead(200, { 'content-length': '20', 'content-type': 'application/octet-stream' });
      res.write('partial');
      setImmediate(() => res.destroy());
      return;
    }
    res.end('healthy');
  });
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: credentials(token).store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  await assert.rejects(fetch(`${hostUrl}/media/video.mp4`).then((response) => response.arrayBuffer()));
  truncate = false;
  const healthy = await fetch(`${hostUrl}/media/video.mp4`);
  assert.equal(healthy.status, 200);
  assert.equal(await healthy.text(), 'healthy');
});

test('reports the Host OS monitor snapshot to the authenticated Manager after registration', async (t) => {
  const calls: Array<{ path: string; authorization: string; monitors?: unknown }> = [];
  const manager = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      calls.push({
        path: req.url ?? '',
        authorization: req.headers.authorization ?? '',
        ...(body ? { monitors: JSON.parse(body).monitors } : {}),
      });
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/api/player/register'
        ? JSON.stringify({ token, device: { id: 'device-1' } })
        : JSON.stringify({ ok: true }));
    });
  });
  const managerUrl = await listen(manager);
  const creds = credentials();
  const monitors = [{
    stableId: 'DISPLAY-REMOTE-1', bindingId: 'MONITOR\\REMOTE-1', deviceName: '\\\\.\\DISPLAY1', friendlyName: 'Remote monitor',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 },
    orientation: 'landscape', primary: true, attached: true,
  }];
  const hostServer = createPlayerHostApp({
    managerUrl,
    credentialStore: creds.store,
    identityStore,
    monitorProvider: async () => ({ supported: true, detectedAt: '2026-11-27T00:00:00.000Z', monitors }),
  }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const response = await fetch(`${hostUrl}/api/player/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'GUGAK1', hardwareId: 'spoofed-browser-id' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.path), ['/api/player/register', '/api/player/native-monitors']);
  assert.deepEqual(calls[1]?.monitors, monitors);
  assert.equal(calls[1]?.authorization, `Bearer ${token}`);
});

test('fetches and atomically persists Manager screen targets without exposing them to the Player renderer', async (t) => {
  const targets = [{ displayId: 'display-remote-1', nativeMonitorId: 'MONITOR\\REMOTE-1' }];
  let managerAvailable = true;
  let assignedTargets: typeof targets | [] = targets;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-player-host-targets-'));
  const assignmentPath = path.join(dataDir, 'control', 'screen-targets.json');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const manager = createServer((req, res) => {
    if (!managerAvailable) { res.statusCode = 503; res.end('{"error":"offline"}'); return; }
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/player/manifest') res.end(JSON.stringify({ manifest: { device: { id: 'device-remote-1' }, wall: { displays: [] } } }));
    else if (req.url === '/api/player/screen-targets') res.end(JSON.stringify({ deviceId: 'device-remote-1', screenTargets: assignedTargets }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({
    managerUrl,
    credentialStore: credentials(token).store,
    identityStore,
    assignmentPath,
  }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  const response = await fetch(`${hostUrl}/api/player/manifest`);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body.manifest, { device: { id: 'device-remote-1' }, wall: { displays: [] } });
  assert.equal('screenTargets' in body, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(assignmentPath, 'utf8')), {
    deviceId: 'device-remote-1', screenTargets: targets,
  });
  assert.deepEqual(fs.readdirSync(path.dirname(assignmentPath)), ['screen-targets.json']);
  assignedTargets = [];
  assert.equal((await fetch(`${hostUrl}/api/player/manifest`)).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(assignmentPath, 'utf8')), {
    deviceId: 'device-remote-1', screenTargets: [],
  });
  managerAvailable = false;
  assert.equal((await fetch(`${hostUrl}/api/player/manifest`)).status, 503);
  assert.deepEqual(JSON.parse(fs.readFileSync(assignmentPath, 'utf8')), {
    deviceId: 'device-remote-1', screenTargets: [],
  });
});

test('failed registration preserves the previously stored credential', async (t) => {
  const manager = createServer((_req, res) => { res.statusCode = 409; res.end('{"error":"conflict"}'); });
  const managerUrl = await listen(manager);
  const creds = credentials(token);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  assert.equal((await fetch(`${hostUrl}/api/player/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 409);
  assert.equal(creds.current(), token);
});

test('does not consume a Manager pairing code when the credential cannot be persisted', async (t) => {
  let managerRequests = 0;
  const manager = createServer((_req, res) => { managerRequests += 1; res.end(JSON.stringify({ token, device: { id: 'device-1' } })); });
  const managerUrl = await listen(manager);
  const brokenStore: PlayerCredentialStore = {
    async readToken() { return null; },
    async writeToken() { throw new Error('DPAPI encryption failed'); },
    async clear() {},
  };
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: brokenStore, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  const response = await fetch(`${hostUrl}/api/player/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'GUGAK1' }),
  });
  assert.equal(response.status, 503);
  assert.equal(managerRequests, 0);
});

test('authenticated player routes load the token from the credential store and clear it on Manager 401', async (t) => {
  const seen: string[] = [];
  const manager = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    res.statusCode = 401;
    res.end('unauthorized');
  });
  const managerUrl = await listen(manager);
  const creds = credentials(token);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  for (const path of ['/api/player/manifest', '/api/player/heartbeat', '/api/player/time']) {
    const response = await fetch(`${hostUrl}${path}`, { method: path.endsWith('heartbeat') ? 'POST' : 'GET' });
    assert.equal(response.status, 401);
  }
  assert.equal(creds.current(), null);
  assert.ok(seen.every((entry) => entry.endsWith(`Bearer ${token}`)));
});

test('requests without a stored token fail closed while config is unauthenticated and host-managed', async (t) => {
  const manager = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ route: req.url }));
  });
  const managerUrl = await listen(manager);
  const creds = credentials();
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  assert.equal((await fetch(`${hostUrl}/api/player/manifest`)).status, 401);
  const configResponse = await fetch(`${hostUrl}/api/player/config`);
  assert.deepEqual(await configResponse.json(), {
    route: '/api/player/config',
    hostManaged: true,
    adminDevicesUrl: `${managerUrl}/admin/#/devices`,
    sampleMode: false,
    sampleCode: null,
  });
});

test('keeps Player configuration host-managed when Manager is offline', async (t) => {
  const managerUrl = 'https://manager.example.test';
  const hostServer = createPlayerHostApp({
    managerUrl,
    credentialStore: credentials(token).store,
    identityStore,
    fetchImpl: async () => { throw new Error('Manager offline'); },
  }).listen(0, '127.0.0.1');
  t.after(() => close(hostServer));
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const response = await fetch(`${hostUrl}/api/player/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    hostManaged: true,
    adminDevicesUrl: 'https://manager.example.test/admin/#/devices',
    sampleMode: false,
    sampleCode: null,
  });
});

test('credential-store read failures return a bounded error without forwarding the request', async (t) => {
  let managerRequests = 0;
  const manager = createServer((_req, res) => { managerRequests += 1; res.end('{}'); });
  const managerUrl = await listen(manager);
  const brokenStore: PlayerCredentialStore = {
    async readToken() { throw new Error('DPAPI decryption failed'); },
    async writeToken() {},
    async clear() {},
  };
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: brokenStore, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));

  const response = await fetch(`${hostUrl}/api/player/manifest`, { signal: AbortSignal.timeout(1000) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Player credential storage is unavailable' });
  assert.equal(managerRequests, 0);
});

test('preserves the legacy public time endpoint through the Host proxy', async (t) => {
  let managerPath = '';
  const manager = createServer((req, res) => {
    managerPath = req.url ?? '';
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'application/json');
    res.end('{"serverTimeMs":1234}');
  });
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: credentials().store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const response = await fetch(`${hostUrl}/api/time`);
  assert.equal(managerPath, '/api/time');
  assert.deepEqual(await response.json(), { serverTimeMs: 1234 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('disconnect clears only the local credential store', async (t) => {
  let managerRequests = 0;
  const manager = createServer((_req, res) => { managerRequests += 1; res.end('{}'); });
  const managerUrl = await listen(manager);
  const creds = credentials(token);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: creds.store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const response = await fetch(`${hostUrl}/api/player/disconnect`, { method: 'POST' });
  assert.equal(response.status, 204);
  assert.equal(creds.current(), null);
  assert.equal(managerRequests, 0);
});

test('rejects untrusted Host and Origin headers', async (t) => {
  const manager = createServer((_req, res) => res.end('{}'));
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: credentials(token).store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  const port = new URL(hostUrl).port;
  assert.equal(await statusWithHeaders(`${hostUrl}/api/player/config`, { host: `evil.test:${port}` }), 403);
  assert.equal(await statusWithHeaders(`${hostUrl}/api/player/config`, { origin: 'https://evil.test' }), 403);
});

test('rejects encoded media traversal and forwards valid range requests with authorization', async (t) => {
  const managerRequests: Array<{ url: string; authorization?: string; range?: string }> = [];
  const manager = createServer((req, res) => {
    managerRequests.push({ url: req.url ?? '', authorization: req.headers.authorization, range: req.headers.range });
    res.statusCode = 206;
    res.setHeader('content-type', 'video/mp4');
    res.setHeader('content-range', 'bytes 2-4/8');
    res.setHeader('accept-ranges', 'bytes');
    res.end(Buffer.from([2, 3, 4]));
  });
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: credentials(token).store, identityStore }).listen(0, '127.0.0.1');
  t.after(async () => { await close(hostServer); await close(manager); });
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  assert.notEqual((await fetch(`${hostUrl}/media/%2e%2e/private`)).status, 206);
  assert.notEqual((await fetch(`${hostUrl}/media/%252e%252e/private`)).status, 206);
  assert.notEqual((await fetch(`${hostUrl}/media/%252525252e%252525252e/private`)).status, 206);
  const response = await fetch(`${hostUrl}/media/image/a%20b.bin?version=4`, { headers: { range: 'bytes=2-4' } });
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4]);
  assert.deepEqual(managerRequests, [{ url: '/media/image/a%20b.bin?version=4', authorization: `Bearer ${token}`, range: 'bytes=2-4' }]);
  assert.equal(response.headers.get('content-range'), 'bytes 2-4/8');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
});

test('requires HTTPS for non-loopback Manager URLs', async () => {
  assert.throws(() => createPlayerHostApp({ managerUrl: 'http://manager.example.test', credentialStore: credentials().store, identityStore }));
  assert.doesNotThrow(() => createPlayerHostApp({ managerUrl: 'http://[::1]:3000', credentialStore: credentials().store, identityStore }));
});
