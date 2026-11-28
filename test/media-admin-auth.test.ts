/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';

test('manager media accepts admin sessions while Player media stays publication-scoped', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-admin-auth-'));
  const config = loadConfig({
    rootDir: path.resolve(import.meta.dirname, '..'), dataDir: temp,
    dbPath: path.join(temp, 'manager.sqlite'), uploadDir: path.join(temp, 'uploads'),
    seedSamples: false, adminPassword: 'media-admin-test', sessionSecret: 'media-admin-session-secret',
    mode: 'lan', role: 'manager',
  });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, 'library-image.png'), 'uploaded image');
  const db = openDatabase(config.dbPath);
  const server = http.createServer(createApp(db, config));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const anonymous = await fetch(`${base}/media/library-image.png`);
  assert.equal(anonymous.status, 401);
  const badCookie = await fetch(`${base}/media/library-image.png`, { headers: { Cookie: 'signage_session=invalid' } });
  assert.equal(badCookie.status, 401);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'media-admin-test' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie?.startsWith('signage_session='));
  const adminMedia = await fetch(`${base}/media/library-image.png`, { headers: { Cookie: cookie } });
  assert.equal(adminMedia.status, 200);
  assert.equal(await adminMedia.text(), 'uploaded image');

  db.prepare(`INSERT INTO devices(id,name,orientation,width,height,pairing_code,hardware_id,player_token_hash,created_at,updated_at)
    VALUES('player-a','player-a','landscape',1920,1080,'PLAYERA','hardware-a',?,datetime('now'),datetime('now'))`)
    .run('unused-hash');
  db.prepare(`INSERT INTO publications(id,device_id,version,snapshot,published_at)
    VALUES('publication-a','player-a',1,?,datetime('now'))`)
    .run(JSON.stringify({ defaultPlaylist: { items: [{ content: { url: '/media/library-image.png' } }] } }));
  db.prepare('UPDATE devices SET published_version = 1 WHERE id = ?').run('player-a');
  const playerAllowed = await fetch(`${base}/media/library-image.png`, { headers: { Authorization: 'Bearer unused-token' } });
  assert.equal(playerAllowed.status, 401, 'invalid Player tokens must not fall back to an admin cookie');

  // Set a valid hashed token, then prove publication membership gates that Player.
  const { hashPlayerToken } = await import('../src/util.js');
  db.prepare('UPDATE devices SET player_token_hash = ? WHERE id = ?').run(hashPlayerToken('valid-player-token'), 'player-a');
  const allowedPlayerMedia = await fetch(`${base}/media/library-image.png`, { headers: { Authorization: 'Bearer valid-player-token' } });
  assert.equal(allowedPlayerMedia.status, 200);
  const unpublishedPlayerMedia = await fetch(`${base}/media/other.png`, { headers: { Authorization: 'Bearer valid-player-token', Cookie: cookie } });
  assert.equal(unpublishedPlayerMedia.status, 403);
});
