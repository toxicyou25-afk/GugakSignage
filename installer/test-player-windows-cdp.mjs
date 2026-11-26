// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { connectLocalDevtoolsWebSocket } from './ops/cdp-websocket.mjs';

function findEdge() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function cdpCommand(socket, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 5000);
    const onMessage = (event) => {
      let response;
      try { response = JSON.parse(event.data); } catch { return; }
      if (response.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      if (response.error) reject(new Error(`CDP failed: ${method}`));
      else resolve(response.result || {});
    };
    const onError = (event) => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      reject(event.error || new Error(event.message));
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id, method, params })), { once: true });
  });
}

test('real Edge accepts Target.createTarget through the origin-free loopback CDP channel', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows Edge only'); return; }
  const edge = findEdge();
  if (!edge) { t.skip('Microsoft Edge is not installed'); return; }

  const tempRoot = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'gugak-player-cdp-'));
  const activePortFile = path.join(profile, 'DevToolsActivePort');
  let browser;
  let cdpSocket;
  let debuggerUrl = '';
  let stage = 'launch';
  try {
    browser = spawn(edge, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && !fs.existsSync(activePortFile)) {
      if (browser.exitCode !== null) throw new Error(`Edge exited before exposing CDP (exit ${browser.exitCode}).`);
      await delay(100);
    }
    assert.ok(fs.existsSync(activePortFile), 'Edge publishes DevToolsActivePort');
    const [portText] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/u);
    const versionResponse = await fetch(`http://127.0.0.1:${portText}/json/version`);
    assert.equal(versionResponse.status, 200);
    const version = await versionResponse.json();
    debuggerUrl = version.webSocketDebuggerUrl;
    stage = 'connect websocket';
    cdpSocket = connectLocalDevtoolsWebSocket(debuggerUrl);
    stage = 'create target';
    const created = await cdpCommand(cdpSocket, 1, 'Target.createTarget', { url: 'about:blank' });
    assert.equal(typeof created.targetId, 'string');
    stage = 'read target list';
    const targets = await (await fetch(`http://127.0.0.1:${portText}/json/list`)).json();
    assert.ok(targets.some((target) => target.id === created.targetId && target.type === 'page'));
  } catch (error) {
    throw new Error(`Edge CDP smoke failed during ${stage}: ${error.message}`, { cause: error });
  } finally {
    try { cdpSocket?.close(); } catch {}
    if (debuggerUrl && browser?.exitCode === null) {
      await new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          try { socket.close(); } catch {}
          resolve();
        };
        const socket = connectLocalDevtoolsWebSocket(debuggerUrl);
        const timeout = setTimeout(finish, 1500);
        socket.addEventListener('open', () => {
          try { socket.send(JSON.stringify({ id: 99, method: 'Browser.close' })); } catch { finish(); }
        }, { once: true });
        socket.addEventListener('message', (event) => {
          try { if (JSON.parse(event.data).id === 99) finish(); } catch { finish(); }
        });
        socket.addEventListener('error', finish, { once: true });
        socket.addEventListener('close', finish, { once: true });
      });
      await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3000)]);
    }
    if (browser?.pid && browser.exitCode === null) {
      try { execFileSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
    }
    const tempPrefix = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
    const resolvedProfile = path.resolve(profile);
    assert.ok(resolvedProfile.startsWith(tempPrefix), 'CDP profile stays inside the system temporary root');
    assert.ok(path.basename(resolvedProfile).startsWith('gugak-player-cdp-'), 'only this test profile is removed');
    for (let attempt = 0; attempt < 8 && fs.existsSync(resolvedProfile); attempt++) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch {}
      if (fs.existsSync(resolvedProfile)) await delay(500);
    }
    assert.ok(!fs.existsSync(resolvedProfile), 'Edge test profile is removed');
  }
});
