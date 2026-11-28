// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyPlayerState } from './ops/watchdog-health.mjs';
import {
  buildPlayerWindowTargets,
  createFullscreenPlayerWindows,
  playerWindowTargetsAreCurrent,
  readTargetsForPlayerReconciliation,
  selectPlayerHealthTargets,
} from './ops/player-windows.mjs';
import { playerStatePath, readPlayerState } from './ops/player-state.mjs';

const now = Date.parse('2026-11-24T12:00:00.000Z');

test('watchdog은 실제 재생과 캐시 재생만 정상으로 판정한다', () => {
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: false, lastHeartbeatAt: '2026-11-24T11:59:30.000Z' },
    }, 60_000),
    { kind: 'playing', responsive: true, healthy: true, actionable: false },
  );
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: true, lastHeartbeatAt: null },
    }, 60_000),
    { kind: 'cached', responsive: true, healthy: true, actionable: false },
  );
});

test('페어링·오류·대기 화면은 응답 상태이지만 정상 재생으로 오판하지 않는다', () => {
  for (const [state, kind] of [
    [{ currentContentId: null, deviceId: null, lastError: null }, 'pairing'],
    [{ currentContentId: null, deviceId: 'device-1', lastError: 'manifest failed' }, 'error-screen'],
    [{ currentContentId: null, deviceId: 'device-1', lastError: null }, 'waiting'],
  ]) {
    assert.deepEqual(
      classifyPlayerState({ playerReady: true, now, state }, 60_000),
      { kind, responsive: true, healthy: false, actionable: false },
    );
  }
});

test('온라인 재생의 오래된 하트비트와 플레이어 미준비는 재시작 대상으로 판정한다', () => {
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: false, lastHeartbeatAt: '2026-11-24T11:55:00.000Z' },
    }, 60_000),
    { kind: 'playback-stalled', responsive: true, healthy: false, actionable: true },
  );
  assert.deepEqual(
    classifyPlayerState({ playerReady: false, state: null, now }, 60_000),
    { kind: 'not-ready', responsive: true, healthy: false, actionable: true },
  );
});

const wallPlayerUrl = 'http://127.0.0.1:3000/player/?code=GUGAK1&reconnect=1';
const screenTargets = [
  { displayId: 'display-a', nativeMonitorId: 'MONITOR\\ABC', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  { displayId: 'display-b', nativeMonitorId: 'MONITOR\\DEF', bounds: { x: 0, y: 0, width: 1080, height: 1920 } },
];

test('display window targets preserve the pairing query and carry physical bounds', () => {
  const targets = buildPlayerWindowTargets(wallPlayerUrl, screenTargets);
  assert.equal(targets.length, 2);
  assert.equal(new URL(targets[0].url).searchParams.get('code'), 'GUGAK1');
  assert.equal(new URL(targets[0].url).searchParams.get('reconnect'), '1');
  assert.equal(new URL(targets[0].url).searchParams.get('display'), 'display-a');
  assert.deepEqual(targets[0].bounds, screenTargets[0].bounds);
  assert.equal(new URL(targets[1].url).searchParams.get('display'), 'display-b');
});

test('unchanged healthy display windows need no fullscreen reconciliation', () => {
  const pages = screenTargets.map((target) => ({
    id: target.displayId,
    url: `http://127.0.0.1:3000/player/?display=${target.displayId}`,
  }));
  assert.equal(playerWindowTargetsAreCurrent(screenTargets, screenTargets, pages), true);
  assert.equal(playerWindowTargetsAreCurrent(screenTargets, screenTargets, pages.slice().reverse()), true);
});

test('display reconciliation runs after bounds change, missing window, or stale window', () => {
  const pages = screenTargets.map((target) => ({
    id: target.displayId,
    url: `http://127.0.0.1:3000/player/?display=${target.displayId}`,
  }));
  const movedTargets = [{ ...screenTargets[0], bounds: { ...screenTargets[0].bounds, x: -2560 } }, screenTargets[1]];
  assert.equal(playerWindowTargetsAreCurrent(screenTargets, movedTargets, pages), false);
  assert.equal(playerWindowTargetsAreCurrent(screenTargets, screenTargets, pages.slice(1)), false);
  assert.equal(playerWindowTargetsAreCurrent(screenTargets, screenTargets, [...pages, {
    id: 'stale', url: 'http://127.0.0.1:3000/player/?display=display-removed',
  }]), false);
});

test('CDP target discovery failure is returned as retryable reconciliation state', async () => {
  const failure = new Error('CDP is not ready');
  const result = await readTargetsForPlayerReconciliation(undefined, async () => { throw failure; });
  assert.deepEqual(result, { targets: null, error: failure });
});

test('display window target validation rejects duplicate or invalid physical bindings', () => {
  assert.throws(() => buildPlayerWindowTargets('https://example.com/player/', screenTargets), /loopback/);
  assert.throws(() => buildPlayerWindowTargets(wallPlayerUrl, [screenTargets[0], screenTargets[0]]), /unique/);
  assert.throws(() => buildPlayerWindowTargets(wallPlayerUrl, [{
    ...screenTargets[0], bounds: { x: 0, y: 0, width: 0, height: 1080 },
  }]), /bounds/);
});

class FakeCdpSocket extends EventTarget {
  messages = [];
  created = 0;
  closed = false;

  constructor(failOnMethod = '') {
    super();
    this.failOnMethod = failOnMethod;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(raw) {
    const message = JSON.parse(raw);
    this.messages.push(message);
    let result = {};
    if (message.method === this.failOnMethod) {
      queueMicrotask(() => this.#respond({ id: message.id, error: { message: 'simulated CDP failure' } }));
      return;
    }
    if (message.method === 'Target.createTarget') result = { targetId: `target-${++this.created}` };
    if (message.method === 'Browser.getWindowForTarget') result = { windowId: this.created };
    if (message.method === 'Target.closeTarget') result = { success: true };
    queueMicrotask(() => this.#respond({ id: message.id, result }));
  }

  #respond(message) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
    this.dispatchEvent(event);
  }

  close() {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}

test('CDP opens one fullscreen window per logical display before closing the fallback canvas', async () => {
  const socket = new FakeCdpSocket();
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    fallbackTargetId: 'fallback-canvas',
    screenTargets,
    existingTargets: [{ id: 'fallback-canvas', url: wallPlayerUrl }],
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.createdTargetIds, ['target-1', 'target-2']);
  const calls = socket.messages;
  assert.equal(calls.filter((call) => call.method === 'Target.createTarget').length, 2);
  assert.equal(calls.some((call) => call.method === 'Browser.createTarget'), false);
  const bounds = calls.filter((call) => call.method === 'Browser.setWindowBounds');
  assert.deepEqual(bounds[0].params.bounds, { left: -1920, top: 0, width: 1920, height: 1080 });
  assert.deepEqual(bounds[1].params.bounds, { windowState: 'fullscreen' });
  assert.equal(calls.at(-1).method, 'Target.closeTarget');
  assert.equal(calls.at(-1).params.targetId, 'fallback-canvas');
  assert.equal(socket.closed, true);
});

test('CDP fallback finalization closes only the fallback after display windows are ready', async () => {
  const socket = new FakeCdpSocket();
  const existingTargets = [
    ...screenTargets.map((target) => ({
      id: `target-${target.displayId}`,
      url: `http://127.0.0.1:3000/player/?display=${target.displayId}`,
    })),
    { id: 'fallback-canvas', url: wallPlayerUrl },
  ];
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    fallbackTargetId: 'fallback-canvas',
    screenTargets,
    existingTargets,
    closeFallback: true,
    skipExistingDisplaySetup: true,
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, true);
  assert.equal(result.fallbackClosed, true);
  assert.deepEqual(result.activeTargetIds, ['target-display-a', 'target-display-b']);
  assert.equal(socket.messages.some((call) => call.method === 'Browser.setWindowBounds'), false);
  assert.deepEqual(socket.messages.filter((call) => call.method === 'Target.closeTarget').map((call) => call.params.targetId), ['fallback-canvas']);
});

test('CDP reuses and repositions existing display windows while a disconnected target keeps fallback playback', async () => {
  const socket = new FakeCdpSocket();
  const existingUrl = new URL(wallPlayerUrl);
  existingUrl.searchParams.set('display', 'display-a');
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    fallbackTargetId: 'fallback-canvas',
    screenTargets,
    existingTargets: [{ id: 'existing-display-a', url: existingUrl.toString() }],
    closeFallback: false,
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.createdTargetIds, ['target-1']);
  assert.deepEqual(result.activeTargetIds, ['existing-display-a', 'target-1']);
  assert.equal(socket.messages.filter((call) => call.method === 'Target.createTarget').length, 1);
  assert.equal(socket.messages.some((call) => call.method === 'Target.closeTarget'), false);
  assert.equal(socket.closed, true);
});

test('CDP restores a fullscreen window before applying changed physical monitor bounds', async () => {
  const socket = new FakeCdpSocket();
  const existingUrl = new URL(wallPlayerUrl);
  existingUrl.searchParams.set('display', 'display-a');
  const movedTarget = {
    ...screenTargets[0],
    bounds: { ...screenTargets[0].bounds, x: -2560, y: 120 },
  };
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    fallbackTargetId: 'fallback-canvas',
    screenTargets: [movedTarget],
    existingTargets: [{ id: 'existing-display-a', url: existingUrl.toString() }],
    closeFallback: false,
    webSocketFactory: () => socket,
  });

  assert.equal(result.success, true);
  const bounds = socket.messages
    .filter((call) => call.method === 'Browser.setWindowBounds')
    .map((call) => call.params.bounds);
  assert.deepEqual(bounds, [
    { windowState: 'normal' },
    { left: -2560, top: 120, width: 1920, height: 1080 },
    { windowState: 'fullscreen' },
  ]);
});

test('CDP creation failure rolls back partial windows and keeps the fallback canvas', async () => {
  class FailSecondTargetSocket extends FakeCdpSocket {
    send(raw) {
      const message = JSON.parse(raw);
      if (message.method === 'Target.createTarget' && this.created > 0) {
        this.messages.push(message);
        queueMicrotask(() => this.#respondForTest({ id: message.id, error: { message: 'simulated CDP failure' } }));
        return;
      }
      super.send(raw);
    }

    #respondForTest(message) {
      const event = new Event('message');
      Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
      this.dispatchEvent(event);
    }
  }
  const socket = new FailSecondTargetSocket();
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    fallbackTargetId: 'fallback-canvas',
    screenTargets,
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.createdTargetIds, []);
  const closed = socket.messages.filter((call) => call.method === 'Target.closeTarget');
  assert.deepEqual(closed.map((call) => call.params.targetId), ['target-1']);
  assert.equal(socket.closed, true);
});

test('reconciliation recreates the fallback canvas and closes stale display windows when an assignment disconnects', async () => {
  const socket = new FakeCdpSocket();
  const staleUrl = new URL(wallPlayerUrl);
  staleUrl.searchParams.set('display', 'display-a');
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    screenTargets: [],
    existingTargets: [{ id: 'stale-display-a', url: staleUrl.toString() }],
    closeFallback: false,
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, true);
  const created = socket.messages.find((call) => call.method === 'Target.createTarget');
  assert.equal(created.params.url, wallPlayerUrl);
  assert.ok(socket.messages.some((call) =>
    call.method === 'Browser.setWindowBounds' && call.params.bounds.windowState === 'fullscreen',
  ));
  assert.deepEqual(
    socket.messages.filter((call) => call.method === 'Target.closeTarget').map((call) => call.params.targetId),
    ['stale-display-a'],
  );
});

test('reconciliation closes stale display windows after all replacement windows are configured', async () => {
  const socket = new FakeCdpSocket();
  const staleUrl = new URL(wallPlayerUrl);
  staleUrl.searchParams.set('display', 'display-removed');
  const result = await createFullscreenPlayerWindows({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    basePlayerUrl: wallPlayerUrl,
    screenTargets: [screenTargets[0]],
    existingTargets: [{ id: 'stale-display', url: staleUrl.toString() }],
    closeFallback: false,
    webSocketFactory: () => socket,
  });
  assert.equal(result.success, true);
  const createIndex = socket.messages.findIndex((call) => call.method === 'Target.createTarget');
  const closeIndex = socket.messages.findIndex((call) => call.method === 'Target.closeTarget');
  assert.ok(createIndex >= 0 && closeIndex > createIndex);
  assert.equal(socket.messages[closeIndex].params.targetId, 'stale-display');
});

test('watchdog health selection checks every assigned display window', () => {
  const pages = screenTargets.map((target) => ({
    id: target.displayId,
    url: new URL(`http://127.0.0.1:3000/player/?display=${target.displayId}`).toString(),
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${target.displayId}`,
  }));
  const selected = selectPlayerHealthTargets(pages, screenTargets.map((target) => target.displayId));
  assert.equal(selected.allAssigned, true);
  assert.deepEqual(selected.pages.map((page) => page.id), ['display-a', 'display-b']);
});

test('watchdog health uses the fallback window while a physical display assignment is missing', () => {
  const pages = [
    { id: 'display-a', url: 'http://127.0.0.1:3000/player/?display=display-a', webSocketDebuggerUrl: 'ws://127.0.0.1/page/a' },
    { id: 'fallback', url: wallPlayerUrl, webSocketDebuggerUrl: 'ws://127.0.0.1/page/fallback' },
  ];
  const selected = selectPlayerHealthTargets(pages, ['display-a', 'display-b']);
  assert.equal(selected.allAssigned, false);
  assert.deepEqual(selected.pages.map((page) => page.id), ['fallback']);
});

test('watchdog state restores screen targets and old state defaults to legacy canvas', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-player-window-state-'));
  try {
    const file = playerStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ desired: 'running', screenTargets }), 'utf8');
    assert.deepEqual(readPlayerState(dataDir).screenTargets, screenTargets);

    fs.writeFileSync(file, JSON.stringify({ desired: 'running', playerUrl: wallPlayerUrl }), 'utf8');
    assert.deepEqual(readPlayerState(dataDir).screenTargets, []);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

