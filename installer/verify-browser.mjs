// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const debugPort = Number.parseInt(argument('--debug-port'), 10);
const screenshotPath = argument('--screenshot');
const outputPath = argument('--output');
const expected = argument('--expect', 'playing');
const timeoutMs = Number.parseInt(argument('--timeout-ms', '45000'), 10);
if (!Number.isInteger(debugPort) || debugPort <= 0) throw new Error('--debug-port is required');

async function getTarget() {
  const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('CDP HTTP ' + response.status);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page' && String(target.url).includes('/player/'));
  if (!page?.webSocketDebuggerUrl) throw new Error('player page target not found');
  return page;
}

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('CDP evaluation timeout'));
    }, 5000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) {
          finish(new Error('CDP evaluation failed'));
          return;
        }
        finish(null, message.result?.result?.value ?? null);
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener('error', () => finish(new Error('CDP connection failed')), { once: true });
  });
}

async function capture(target, destination) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('CDP screenshot timeout'));
    }, 15000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id === 1) {
          socket.send(JSON.stringify({
            id: 2,
            method: 'Page.captureScreenshot',
            params: { format: 'png', fromSurface: true, captureBeyondViewport: false },
          }));
        } else if (message.id === 2) {
          if (!message.result?.data) {
            finish(new Error('empty screenshot'));
            return;
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, Buffer.from(message.result.data, 'base64'));
          finish(null);
        }
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener('error', () => finish(new Error('CDP screenshot connection failed')), { once: true });
  });
}

function matches(state) {
  if (!state?.playerReady) return false;
  if (!state.currentContentId) return false;
  if (expected === 'offline') return state.offline === true;
  if (expected === 'online') return state.offline === false;
  return true;
}

const deadline = Date.now() + timeoutMs;
let target = null;
let state = null;
let lastError = null;
while (Date.now() < deadline) {
  try {
    target = await getTarget();
    state = await evaluate(target, '({ playerReady: Boolean(window.__signagePlayer), ...(window.__signagePlayer?.getState?.() || {}), visibility: document.visibilityState })');
    lastError = null;
    if (matches(state)) break;
  } catch (error) {
    lastError = error.message;
    // The watchdog may still be starting the browser or loading the player.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!matches(state)) {
  throw new Error('player state did not match ' + expected + ': ' + JSON.stringify({ state, lastError }));
}

if (screenshotPath) await capture(target, screenshotPath);
const result = {
  checkedAt: new Date().toISOString(),
  expected,
  url: target.url,
  state,
  screenshot: screenshotPath || null,
};
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}
process.stdout.write(JSON.stringify(result) + '\n');
