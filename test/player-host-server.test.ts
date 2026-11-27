/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PlayerCredentialStore } from '../src/player-credentials.js';
import { createPlayerHostServer } from '../src/player-host-server.js';
import { validatePlayerManagerTrust } from '../src/player-host-main.js';

const credentials: PlayerCredentialStore = {
  async readToken() { return null; },
  async writeToken() {},
  async clear() {},
};
const identityStore = { async getOrCreateHardwareId() { return 'stable-host-id'; } };

test('serves only Player UI and engine assets with safe headers', async (t) => {
  const host = createPlayerHostServer({ managerUrl: 'http://127.0.0.1:4321', credentialStore: credentials, identityStore, port: 0 });
  await host.start();
  t.after(() => host.close());
  assert.equal(host.server.address() && typeof host.server.address() !== 'string' ? host.server.address()?.address : null, '127.0.0.1');
  const base = `http://127.0.0.1:${host.port}`;

  const root = await fetch(base, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/player/');
  const player = await fetch(`${base}/player/`);
  assert.equal(player.status, 200);
  assert.match(await player.text(), /Player/i);
  assert.match(player.headers.get('content-security-policy') ?? '', /frame-src 'self' http: https:/);
  assert.match(player.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(player.headers.get('x-content-type-options'), 'nosniff');

  const engine = await fetch(`${base}/engine/index.js`);
  assert.equal(engine.status, 200);
  assert.ok((await engine.text()).length > 0);
  assert.equal((await fetch(`${base}/admin/`)).status, 404);
  assert.equal((await fetch(`${base}/admin/index.html`)).status, 404);
});

test('rejects any bind host other than exactly 127.0.0.1', async () => {
  assert.throws(() => createPlayerHostServer({ managerUrl: 'https://manager.example.test', credentialStore: credentials, identityStore, host: 'localhost' }), /127\.0\.0\.1/);
  assert.throws(() => createPlayerHostServer({ managerUrl: 'https://manager.example.test', credentialStore: credentials, identityStore, host: '0.0.0.0' }), /127\.0\.0\.1/);
});

test('remote Player Host TLS requires a readable CA bundle and never allows verification bypass', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'player-host-ca-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const caFile = path.join(directory, 'manager-ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n');
  assert.doesNotThrow(() => validatePlayerManagerTrust('http://127.0.0.1:3000'));
  assert.throws(() => validatePlayerManagerTrust('http://127.0.0.1:3000', undefined, '0'), /not allowed/);
  assert.throws(() => validatePlayerManagerTrust('http://localhost:3000', undefined, '0'), /not allowed/);
  assert.throws(() => validatePlayerManagerTrust('http://manager.example.test'), /HTTPS/);
  assert.throws(() => validatePlayerManagerTrust('https://manager.example.test'), /trusted CA certificate bundle/);
  assert.throws(() => validatePlayerManagerTrust('https://manager.example.test', path.join(directory, 'missing.pem')), /not readable/);
  const malformedCaFile = path.join(directory, 'malformed-ca.pem');
  fs.writeFileSync(malformedCaFile, '-----BEGIN CERTIFICATE-----\nmissing-end-marker\n');
  assert.throws(() => validatePlayerManagerTrust('https://manager.example.test', malformedCaFile), /PEM certificate/);
  assert.throws(() => validatePlayerManagerTrust('https://manager.example.test', caFile, '0'), /not allowed/);
  assert.doesNotThrow(() => validatePlayerManagerTrust('https://manager.example.test', caFile));
});
