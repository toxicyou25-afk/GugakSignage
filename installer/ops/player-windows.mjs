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
      const window = await cdp.call('Browser.getWindowForTarget', { targetId });
      if (!Number.isInteger(window.windowId)) throw new Error('CDP returned no window ID.');
      await cdp.call('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: {
          left: target.bounds.x,
          top: target.bounds.y,
          width: target.bounds.width,
          height: target.bounds.height,
          windowState: 'normal',
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
          await cdp.call('Target.closeTarget', { targetId: stale.id });
        }
      } catch { /* ignore malformed targets; only close recognized Player windows */ }
    }
    if (closeFallback && fallbackId && !active.includes(fallbackId)) {
      await cdp.call('Target.closeTarget', { targetId: fallbackId });
      fallbackClosed = true;
    }
    return { success: true, createdTargetIds: created, activeTargetIds: active, fallbackId: fallbackId || null, fallbackClosed };
  } catch (error) {
    for (const targetId of created.slice().reverse()) {
      try { await cdp.call('Target.closeTarget', { targetId }); } catch { /* rollback is best-effort */ }
    }
    return { success: false, createdTargetIds: [], activeTargetIds: [], fallbackClosed: false, error: 'cdp-window-setup-failed', detail: error.message };
  } finally {
    cdp.close();
  }
}
