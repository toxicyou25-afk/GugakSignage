/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import test from 'node:test';
import type { PlayerCredentialStore } from '../src/player-credentials.js';
import { createPlayerHostApp } from '../src/player-host.js';

const token = 'a'.repeat(64);
const identityStore = { async getOrCreateHardwareId() { return 'stable-host-id'; } };
const credentials: PlayerCredentialStore = {
  async readToken() { return token; },
  async writeToken() {},
  async clear() {},
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('truncated upstream media after headers fails only that response and Player Host survives', async (t) => {
  let managerResponseStarted!: () => void;
  const responseStarted = new Promise<void>((resolve) => { managerResponseStarted = resolve; });
  const manager = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '100' });
    res.write(Buffer.from([0, 1, 2]));
    managerResponseStarted();
    setTimeout(() => res.destroy(new Error('simulated upstream truncation')), 20);
  });
  const managerUrl = await listen(manager);
  const hostServer = createPlayerHostApp({ managerUrl, credentialStore: credentials, identityStore }).listen(0, '127.0.0.1');
  const hostUrl = await new Promise<string>((resolve) => hostServer.once('listening', () => {
    const address = hostServer.address();
    assert.ok(address && typeof address !== 'string');
    resolve(`http://127.0.0.1:${address.port}`);
  }));
  t.after(async () => { await close(hostServer); await close(manager); });

  const failedResponse = new Promise<{ status: number; truncated: boolean }>((resolve, reject) => {
    const request = httpRequest(`${hostUrl}/media/video.mp4`, (response) => {
      let truncated = false;
      response.on('aborted', () => { truncated = true; });
      response.on('error', () => { truncated = true; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, truncated }));
      response.on('close', () => {
        if (!response.complete) resolve({ status: response.statusCode ?? 0, truncated: true });
      });
      response.resume();
    });
    request.on('error', reject);
    request.end();
  });

  await responseStarted;
  const result = await failedResponse;
  assert.equal(result.status, 200);
  assert.equal(result.truncated, true);
  const afterFailure = await fetch(`${hostUrl}/after-stream-failure`, { signal: AbortSignal.timeout(1000) });
  assert.equal(afterFailure.status, 404);
});
