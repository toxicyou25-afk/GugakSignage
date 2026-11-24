// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.js';

async function json(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url} returned ${response.status}`);
  return response.json();
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function freshServer(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugak-server-'));
  const statePath = path.join(dir, 'state.json');
  const server = await startServer({ port: 0, statePath, reset: true, quiet: true });
  t.after(async () => {
    await server.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { server, dir, statePath };
}

test('server exposes time, site summaries, manifests, and media', async (t) => {
  const { server } = await freshServer(t);
  const time = await fetch(`${server.url}/api/time`);
  assert.equal(time.status, 200);
  assert.match(time.headers.get('cache-control') ?? '', /no-store/);
  const timeBody = await time.json();
  assert(Number.isFinite(timeBody.now));

  const sites = await json(`${server.url}/api/sites`);
  assert.equal(sites.length, 4);
  const byId = Object.fromEntries(sites.map((site) => [site.id, site]));
  assert.equal(byId['site-a'].displayCount, 4);
  assert.equal(byId['site-a'].imageCount, 3);
  assert.equal(byId['site-b'].displayCount, 1);
  assert.equal(byId['site-c'].displayCount, 6);
  assert.equal(byId['site-c'].imageCount, 10);
  assert.equal(byId['site-d'].imageCount, 0);

  const manifest = await json(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`);
  assert.equal(manifest.displayId, 'disp-a1');
  assert.equal(manifest.mode, 'synchronized-cycle');
  assert.equal(manifest.displays.length, 4);
  assert.equal(manifest.images.length, 3);
  assert.equal(manifest.pattern.periodSlots, 12);
  assert.equal(manifest.validation.summary.errors, 0);
  assert.match(manifest.epoch, /Z$/);

  const missing = await fetch(`${server.url}/api/sites/site-a/manifest?displayId=disp-c1`);
  assert.equal(missing.status, 404);
  const media = await fetch(`${server.url}${manifest.images[0].displayUrl}`);
  assert.equal(media.status, 200);
  assert.match(media.headers.get('content-type') ?? '', /image\/svg/);
  const svg = await media.text();
  assert.match(svg, /<svg/);
  assert.match(svg, /ORIGINAL DEMO ASSET/);

  const preview = await fetch(`${server.url}/preview/`);
  assert.equal(preview.status, 200);
  const player = await fetch(`${server.url}/player/`);
  assert.equal(player.status, 200);
  const engine = await fetch(`${server.url}/engine/index.js`);
  assert.equal(engine.status, 200);
  assert.match(engine.headers.get('content-type') ?? '', /javascript/);
});

test('registration, heartbeat, add and remove maintain stable playback', async (t) => {
  const { server } = await freshServer(t);
  const register = await post(`${server.url}/api/displays/register`, {
    siteId: 'site-a',
    displayId: 'disp-a1',
    hardwareId: 'browser-test-hardware',
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
    userAgent: 'node-test',
  });
  assert.equal(register.status, 200);
  assert.equal(register.body.paired, true);
  assert.equal(register.body.displayId, 'disp-a1');

  const heartbeat = await post(`${server.url}/api/displays/disp-a1/heartbeat`, {
    clientTime: Date.now(),
    imageId: 'asset-welcome',
    imageIndex: 0,
    slot: 1,
    mode: 'synchronized-cycle',
    fit: 'contain',
    offline: false,
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.ok, true);
  assert.equal(heartbeat.body.nextHeartbeatMs, 30_000);

  const before = await json(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`);
  const at = Date.now() + 1_000;
  const beforePlan = await json(
    `${server.url}/api/sites/site-a/manifest?displayId=disp-a1`,
  );
  assert.equal(beforePlan.displays.find((display) => display.id === 'disp-a1').status, 'online');

  const added = await post(`${server.url}/api/displays/register`, {
    siteKey: 'demo-a',
    hardwareId: 'add-remove-test-hardware',
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.created, true);
  const addedId = added.body.displayId;
  const withFive = await json(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`);
  assert.equal(withFive.displays.length, 5);
  assert.equal(withFive.layout.slots.length, 5);
  assert.equal(withFive.displays.find((display) => display.id === 'disp-a1').slotId, 'slot-1');

  const removed = await fetch(`${server.url}/api/displays/${encodeURIComponent(addedId)}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.equal(removedBody.displayCount, 4);
  const after = await json(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`);
  assert.equal(after.displays.length, 4);
  assert.equal(after.layout.slots.length, 4);
  assert.equal(after.displays.find((display) => display.id === 'disp-a1').slotId, 'slot-1');
  assert.equal(after.version, before.version + 2);
  assert.equal(after.epoch, before.epoch);
  assert(Number.isFinite(at));
});

test('custom layout removal leaves an empty slot and auto-add fills it', async (t) => {
  const { server } = await freshServer(t);
  const before = await json(`${server.url}/api/sites/site-c/manifest?displayId=disp-c1`);
  const removed = await fetch(`${server.url}/api/displays/disp-c2`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const afterRemove = await json(`${server.url}/api/sites/site-c/manifest?displayId=disp-c1`);
  assert.equal(afterRemove.displays.length, 5);
  assert.equal(afterRemove.layout.slots.length, 6);
  assert.equal(afterRemove.epoch, before.epoch);

  const added = await post(`${server.url}/api/displays/register`, {
    siteKey: 'demo-c',
    hardwareId: 'custom-refill-hardware',
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
  });
  assert.equal(added.status, 201);
  const afterAdd = await json(`${server.url}/api/sites/site-c/manifest?displayId=disp-c1`);
  assert.equal(afterAdd.displays.length, 6);
  assert.equal(afterAdd.displays.find((display) => display.id === added.body.displayId).slotId, 'slot-2');
});

test('state file survives restart with the same epoch and registered display', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugak-restart-'));
  const statePath = path.join(dir, 'state.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  let server = await startServer({ port: 0, statePath, reset: true, quiet: true });
  const epoch = (await json(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`)).epoch;
  const added = await post(`${server.url}/api/displays/register`, {
    siteKey: 'demo-b',
    hardwareId: 'restart-hardware',
    resolution: { width: 1080, height: 1920 },
    orientation: 'portrait',
  });
  assert.equal(added.status, 201);
  await server.close();

  const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert(persisted.sites.find((site) => site.id === 'site-b').displays.some((display) => display.id === added.body.displayId));
  const offline = await fetch(`${server.url}/api/time`).catch((error) => error);
  assert(offline instanceof Error);

  server = await startServer({ port: 0, statePath, quiet: true });
  t.after(async () => {
    await server.close().catch(() => {});
  });
  const restored = await json(`${server.url}/api/sites/site-b/manifest?displayId=${encodeURIComponent(added.body.displayId)}`);
  assert.equal(restored.epoch, epoch);
  assert.equal(restored.displays.length, 2);
});
