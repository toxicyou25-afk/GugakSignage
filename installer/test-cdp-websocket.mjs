// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import test from 'node:test';
import { connectLocalDevtoolsWebSocket } from './ops/cdp-websocket.mjs';

function serverFrame(payload) {
  const body = Buffer.from(payload, 'utf8');
  assert.ok(body.length < 126);
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
}

test('loopback CDP websocket sends no Origin header and exchanges masked JSON frames', async (t) => {
  let serverSocket;
  const server = net.createServer((socket) => {
    serverSocket = socket;
    let buffered = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!upgraded) {
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headers = buffered.subarray(0, headerEnd).toString('latin1');
        assert.match(headers, /^GET \/devtools\/browser\/test HTTP\/1\.1/mu);
        assert.doesNotMatch(headers, /^Origin:/imu);
        const key = headers.match(/^Sec-WebSocket-Key:\s*(.+)$/imu)?.[1]?.trim();
        assert.ok(key);
        const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        buffered = buffered.subarray(headerEnd + 4);
        upgraded = true;
      }
      if (buffered.length < 6) return;
      const first = buffered[0];
      const second = buffered[1];
      const length = second & 0x7f;
      if ((first & 0x0f) !== 1 || !(second & 0x80) || length === 126 || length === 127) throw new Error('Expected one short masked JSON frame.');
      if (buffered.length < 6 + length) return;
      const mask = buffered.subarray(2, 6);
      const payload = Buffer.from(buffered.subarray(6, 6 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
      const command = JSON.parse(payload.toString('utf8'));
      assert.equal(command.method, 'Target.createTarget');
      socket.write(serverFrame(JSON.stringify({ id: command.id, result: { targetId: 'target-real' } })));
      buffered = buffered.subarray(6 + length);
    });
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  t.after(async () => {
    serverSocket?.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const socket = connectLocalDevtoolsWebSocket(`ws://127.0.0.1:${address.port}/devtools/browser/test`);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP websocket test timed out.')), 2000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } })));
    socket.addEventListener('message', (event) => {
      clearTimeout(timeout);
      const message = JSON.parse(event.data);
      assert.equal(message.result.targetId, 'target-real');
      resolve();
    }, { once: true });
    socket.addEventListener('error', (event) => { clearTimeout(timeout); reject(event.error || new Error(event.message)); }, { once: true });
  });
});

test('CDP websocket rejects non-loopback endpoints', () => {
  assert.throws(() => connectLocalDevtoolsWebSocket('ws://192.168.1.10:9222/devtools/browser/test'), /loopback/);
  assert.throws(() => connectLocalDevtoolsWebSocket('wss://127.0.0.1:9222/devtools/browser/test'), /ws:\/\//);
});
