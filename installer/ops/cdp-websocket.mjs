// SPDX-License-Identifier: Apache-2.0
import crypto from 'node:crypto';
import net from 'node:net';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function dispatch(target, type, properties = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}

function clientFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length > MAX_MESSAGE_BYTES) throw new Error('CDP message exceeds the allowed size.');
  const extendedLength = body.length < 126 ? 0 : body.length <= 0xffff ? 2 : 8;
  const maskOffset = 2 + extendedLength;
  const header = Buffer.alloc(maskOffset + 4);
  header[0] = 0x80 | opcode;
  if (!extendedLength) header[1] = 0x80 | body.length;
  else if (extendedLength === 2) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  const mask = crypto.randomBytes(4);
  mask.copy(header, maskOffset);
  const masked = Buffer.allocUnsafe(body.length);
  for (let index = 0; index < body.length; index++) masked[index] = body[index] ^ mask[index % 4];
  return Buffer.concat([header, masked]);
}

export function connectLocalDevtoolsWebSocket(rawUrl, { handshakeTimeoutMs = 5000 } = {}) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('CDP websocket must use ws:// on loopback.');
  }
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const port = Number(url.port || 80);
  const requestTarget = `${url.pathname || '/'}${url.search}`;
  const hostHeader = `${url.hostname.includes(':') ? `[${host}]` : host}:${port}`;
  const socket = net.connect({ host, port });
  const target = new EventTarget();
  let state = 'connecting';
  let receivedUpgradeBytes = false;
  let closeDispatched = false;
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = 0;
  let handshakeTimer;
  const websocketKey = crypto.randomBytes(16).toString('base64');

  function notifyClose() {
    if (closeDispatched) return;
    closeDispatched = true;
    dispatch(target, 'close');
  }

  function fail(error) {
    if (state === 'closed') return;
    state = 'closed';
    clearTimeout(handshakeTimer);
    dispatch(target, 'error', { error, message: error.message });
    try { socket.destroy(); } catch { /* failed sockets are best-effort */ }
    notifyClose();
  }

  function emitMessage(opcode, payload) {
    if (opcode === 1) dispatch(target, 'message', { data: payload.toString('utf8') });
    else if (opcode === 2) dispatch(target, 'message', { data: payload });
  }

  function readFrames() {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        const wideLength = buffer.readBigUInt64BE(offset);
        if (wideLength > BigInt(MAX_MESSAGE_BYTES)) throw new Error('CDP message exceeds the allowed size.');
        length = Number(wideLength);
        offset += 8;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];

      if (opcode === 8) {
        state = 'closed';
        socket.end(clientFrame(8, payload));
        notifyClose();
        return;
      }
      if (opcode === 9) {
        socket.write(clientFrame(10, payload));
        continue;
      }
      if (opcode === 10) continue;
      if (opcode === 0) {
        if (!fragmentOpcode) continue;
        fragments.push(payload);
        if (fin) {
          emitMessage(fragmentOpcode, Buffer.concat(fragments));
          fragments = [];
          fragmentOpcode = 0;
        }
        continue;
      }
      if (opcode !== 1 && opcode !== 2) continue;
      if (!fin) {
        fragmentOpcode = opcode;
        fragments = [payload];
      } else {
        emitMessage(opcode, payload);
      }
    }
  }

  socket.on('connect', () => {
    const headers = [
      `GET ${requestTarget} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${websocketKey}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ];
    socket.write(headers.join('\r\n'));
  });
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (state === 'connecting') {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const headerText = buffer.subarray(0, end).toString('latin1');
      const lines = headerText.split('\r\n');
      if (!/^HTTP\/1\.[01] 101\b/u.test(lines[0] || '')) {
        fail(new Error(`CDP websocket handshake rejected: ${lines[0] || 'invalid response'}`));
        return;
      }
      const accept = lines.find((line) => /^sec-websocket-accept:/iu.test(line))?.split(':', 2)[1]?.trim();
      const expected = crypto.createHash('sha1').update(websocketKey + WEBSOCKET_GUID).digest('base64');
      if (accept !== expected) {
        fail(new Error('CDP websocket handshake returned an invalid accept key.'));
        return;
      }
      buffer = buffer.subarray(end + 4);
      state = 'open';
      receivedUpgradeBytes = true;
      clearTimeout(handshakeTimer);
    }
    if (state === 'open') {
      if (receivedUpgradeBytes) {
        receivedUpgradeBytes = false;
        dispatch(target, 'open');
        if (buffer.length < 2) return;
      }
      try { readFrames(); } catch (error) { fail(error); }
    }
  });
  socket.on('error', (error) => fail(error));
  socket.on('close', () => {
    if (state !== 'closed') {
      state = 'closed';
      clearTimeout(handshakeTimer);
    }
    notifyClose();
  });
  handshakeTimer = setTimeout(() => fail(new Error('CDP websocket handshake timed out.')), handshakeTimeoutMs);

  target.send = (value) => {
    if (state !== 'open') throw new Error('CDP websocket is not open.');
    if (process.env.GUGAK_CDP_TRACE === '1') process.stderr.write(`CDP send ${String(value)}\n`);
    socket.write(clientFrame(1, String(value)));
  };
  target.close = () => {
    if (state === 'closed') return;
    const wasOpen = state === 'open';
    state = 'closed';
    clearTimeout(handshakeTimer);
    if (wasOpen) socket.end(clientFrame(8, Buffer.alloc(0)));
    else socket.destroy();
    if (wasOpen) socket.once('close', notifyClose);
    else notifyClose();
  };
  return target;
}
