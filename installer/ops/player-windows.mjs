// SPDX-License-Identifier: Apache-2.0
import { connectLocalDevtoolsWebSocket } from './cdp-websocket.mjs';

function normalizeBounds(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid physical monitor bounds.');
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 320 || height < 320 || width > 16384 || height > 16384) {
    throw new Error('Invalid physical monitor bounds.');
  }
  return { x, y, width, height };
}

export function buildPlayerWindowTargets(basePlayerUrl, screenTargets) {
  let base;
  try { base = new URL(String(basePlayerUrl || '')); } catch { throw new Error('Invalid player URL.'); }
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !/^\/player\/?$/u.test(base.pathname)) {
    throw new Error('Player windows require a loopback player URL.');
  }
  if (!Array.isArray(screenTargets)) throw new Error('Invalid physical monitor assignments.');

  const displays = new Set();
  const monitors = new Set();
  return screenTargets.map((target) => {
    const displayId = typeof target?.displayId === 'string' ? target.displayId.trim() : '';
    const nativeMonitorId = typeof target?.nativeMonitorId === 'string' ? target.nativeMonitorId.trim() : '';
    if (!displayId || displayId.length > 100 || !nativeMonitorId || nativeMonitorId.length > 512 || !/^MONITOR\\/iu.test(nativeMonitorId)) {
      throw new Error('Invalid physical monitor assignment.');
    }
    if (displays.has(displayId) || monitors.has(nativeMonitorId)) {
      throw new Error('Physical monitor assignments must be unique.');
    }
    displays.add(displayId);
    monitors.add(nativeMonitorId);
    const bounds = normalizeBounds(target.bounds);
    const url = new URL(base.toString());
    url.searchParams.set('display', displayId);
    return { displayId, nativeMonitorId, bounds, url: url.toString() };
  });
}

function windowTargetKey(target) {
  if (!target || typeof target.displayId !== 'string' || typeof target.nativeMonitorId !== 'string') return null;
  const bounds = target.bounds;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)) return null;
  return JSON.stringify({
    displayId: target.displayId,
    nativeMonitorId: target.nativeMonitorId,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  });
}

export function playerWindowTargetsAreCurrent(previousTargets, desiredTargets, existingTargets) {
  if (!Array.isArray(previousTargets) || !Array.isArray(desiredTargets) || !Array.isArray(existingTargets) ||
      desiredTargets.length === 0 || previousTargets.length !== desiredTargets.length ||
      existingTargets.length !== desiredTargets.length) return false;
  const previousByDisplay = new Map();
  const desiredByDisplay = new Map();
  for (const [list, targets] of [[previousByDisplay, previousTargets], [desiredByDisplay, desiredTargets]]) {
    for (const target of targets) {
      const key = windowTargetKey(target);
      if (!key || list.has(target.displayId)) return false;
      list.set(target.displayId, key);
    }
  }
  if ([...desiredByDisplay].some(([displayId, key]) => previousByDisplay.get(displayId) !== key)) return false;
  const existingDisplayIds = new Set();
  for (const target of existingTargets) {
    try {
      const url = new URL(target?.url);
      const displayId = url.searchParams.get('display');
      if (!displayId || !desiredByDisplay.has(displayId) || existingDisplayIds.has(displayId)) return false;
      existingDisplayIds.add(displayId);
    } catch {
      return false;
    }
  }
  return existingDisplayIds.size === desiredByDisplay.size;
}

export async function readTargetsForPlayerReconciliation(existingTargets, readTargets) {
  if (Array.isArray(existingTargets)) return { targets: existingTargets, error: null };
  try {
    const targets = await readTargets();
    if (!Array.isArray(targets)) throw new Error('CDP target list is invalid.');
    return { targets, error: null };
  } catch (error) {
    return { targets: null, error };
  }
}

export function selectPlayerHealthTargets(playerPages, displayIds) {
  const pages = Array.isArray(playerPages) ? playerPages : [];
  const ids = Array.isArray(displayIds) ? displayIds : [];
  const byDisplay = new Map();
  for (const page of pages) {
    try {
      const url = new URL(page?.url);
      const displayId = url.searchParams.get('display');
      if (displayId && typeof page?.webSocketDebuggerUrl === 'string') byDisplay.set(displayId, page);
    } catch { /* ignore malformed targets */ }
  }
  const assigned = ids.map((displayId) => byDisplay.get(displayId));
  if (ids.length > 0 && assigned.every(Boolean)) return { pages: assigned, allAssigned: true };
  const fallback = pages.find((page) => {
    if (typeof page?.webSocketDebuggerUrl !== 'string') return false;
    try { return !new URL(page.url).searchParams.has('display'); } catch { return false; }
  });
  const firstResponsive = fallback || pages.find((page) => typeof page?.webSocketDebuggerUrl === 'string') || null;
  return { pages: firstResponsive ? [firstResponsive] : [], allAssigned: false };
}

function createCdpSession(socket, timeoutMs) {
  let nextId = 1;
  const pending = new Map();
  let resolveOpen;
  let rejectOpen;
  let opened = false;
  const ready = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  const onOpen = () => {
    opened = true;
    resolveOpen();
  };
  const onError = (event) => {
    const error = event?.error instanceof Error ? event.error : new Error(event?.message || 'CDP connection failed.');
    if (!opened) rejectOpen(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  const onClose = () => onError();
  const onMessage = (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`CDP command failed: ${entry.method}.`));
    else entry.resolve(message.result || {});
  };
  socket.addEventListener('open', onOpen, { once: true });
  socket.addEventListener('error', onError, { once: true });
  socket.addEventListener('close', onClose, { once: true });
  socket.addEventListener('message', onMessage);

  return {
    async call(method, params = {}) {
      await ready;
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}.`));
        }, timeoutMs);
        pending.set(id, { method, resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error(`CDP command failed: ${method}.`));
        }
      });
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('CDP connection closed.'));
      }
      pending.clear();
      try { socket.close(); } catch { /* closing a failed socket is best-effort */ }
    },
  };
}

export async function createFullscreenPlayerWindows({
  webSocketDebuggerUrl,
  basePlayerUrl,
  fallbackTargetId = '',
  screenTargets,
  existingTargets = [],
  closeFallback = true,
  skipExistingDisplaySetup = false,
  webSocketFactory = (url) => connectLocalDevtoolsWebSocket(url),
  timeoutMs = 5000,
}) {
  const targets = buildPlayerWindowTargets(basePlayerUrl, screenTargets);
  if (!targets.length && closeFallback) return { success: true, createdTargetIds: [], fallbackClosed: false };
  const base = new URL(String(basePlayerUrl));
  let debuggerUrl;
  try { debuggerUrl = new URL(String(webSocketDebuggerUrl || '')); } catch { return { success: false, createdTargetIds: [], error: 'invalid-cdp-url' }; }
  if (debuggerUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(debuggerUrl.hostname)) {
    return { success: false, createdTargetIds: [], error: 'non-loopback-cdp-url' };
  }

  let socket;
  try { socket = webSocketFactory(debuggerUrl.toString()); } catch { return { success: false, createdTargetIds: [], error: 'cdp-connect-failed' }; }
  const cdp = createCdpSession(socket, timeoutMs);
  const created = [];
  const active = [];
  let fallbackClosed = false;
  let fallbackId = fallbackTargetId;
  try {
    if (!fallbackId) {
      const existingFallback = existingTargets.find((candidate) => {
        try {
          const url = new URL(candidate.url);
          return url.origin === base.origin && url.pathname === base.pathname &&
            !url.searchParams.has('display') && typeof candidate.id === 'string';
        } catch { return false; }
      });
      fallbackId = typeof existingFallback?.id === 'string' ? existingFallback.id : '';
    }
    if (!closeFallback && !fallbackId) {
      const fallback = await cdp.call('Target.createTarget', { url: base.toString(), newWindow: true });
      if (typeof fallback.targetId !== 'string' || !fallback.targetId) throw new Error('CDP returned no fallback target ID.');
      fallbackId = fallback.targetId;
      const fallbackWindow = await cdp.call('Browser.getWindowForTarget', { targetId: fallbackId });
      if (!Number.isInteger(fallbackWindow.windowId)) throw new Error('CDP returned no fallback window ID.');
      await cdp.call('Browser.setWindowBounds', {
        windowId: fallbackWindow.windowId,
        bounds: { windowState: 'fullscreen' },
      });
    }
    for (const target of targets) {
      const existing = existingTargets.find((candidate) => {
        try { return new URL(candidate.url).searchParams.get('display') === target.displayId; } catch { return false; }
      });
      let targetId = typeof existing?.id === 'string' ? existing.id : '';
      if (!targetId) {
        const result = await cdp.call('Target.createTarget', {
          url: target.url,
          newWindow: true,
        });
        if (typeof result.targetId !== 'string' || !result.targetId) throw new Error('CDP returned no target ID.');
        targetId = result.targetId;
        created.push(targetId);
      }
      active.push(targetId);
      if (existing && skipExistingDisplaySetup) continue;
      const window = await cdp.call('Browser.getWindowForTarget', { targetId });
      if (!Number.isInteger(window.windowId)) throw new Error('CDP returned no window ID.');
      if (existing) {
        await cdp.call('Browser.setWindowBounds', {
          windowId: window.windowId,
          bounds: { windowState: 'normal' },
        });
      }
      await cdp.call('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: {
          left: target.bounds.x,
          top: target.bounds.y,
          width: target.bounds.width,
          height: target.bounds.height,
        },
      });
      await cdp.call('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: { windowState: 'fullscreen' },
      });
    }
    const desiredDisplays = new Set(targets.map((target) => target.displayId));
    for (const stale of existingTargets) {
      if (typeof stale?.id !== 'string' || active.includes(stale.id)) continue;
      try {
        const url = new URL(stale.url);
        const staleDisplay = url.searchParams.get('display');
        if (staleDisplay && !desiredDisplays.has(staleDisplay)) {
          awai…1380 tokens truncated…http://127.0.0.1:3000/player/?display=display-removed',
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

