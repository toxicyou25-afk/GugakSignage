/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const STORAGE = {
  token: 'signage.player.token',
  hardwareId: 'signage.player.hardwareId',
  deviceId: 'signage.player.deviceId',
  manifest: 'signage.player.manifest.v1',
  lastCode: 'signage.player.lastCode',
};
const POLL_MS = 15_000;
const HEARTBEAT_MS = 15_000;

const $ = (selector) => document.querySelector(selector);
const el = {
  pair: $('#pair-view'),
  pairForm: $('#pair-form'),
  pairCode: $('#pair-code'),
  pairError: $('#pair-error'),
  pairButton: $('#pair-button'),
  pairRecover: $('#pair-recover'),
  sampleHint: $('#sample-hint'),
  sampleCode: $('#sample-code'),
  sampleConnect: $('#sample-connect'),
  player: $('#player-view'),
  stage: $('#stage'),
  offline: $('#offline-badge'),
  waiting: $('#waiting-view'),
  waitingTitle: $('#waiting-title'),
  waitingMessage: $('#waiting-message'),
  empty: $('#empty-view'),
  error: $('#error-view'),
  errorTitle: $('#error-title'),
  errorMessage: $('#error-message'),
  retry: $('#retry-button'),
  controls: $('#controls'),
  deviceLabel: $('#device-label'),
  fullscreen: $('#fullscreen-button'),
  disconnect: $('#disconnect-button'),
};

const runtime = {
  token: safeGet(STORAGE.token),
  deviceId: safeGet(STORAGE.deviceId),
  manifest: null,
  pendingManifest: null,
  playlistId: null,
  queue: [],
  index: 0,
  currentItem: null,
  currentContentId: null,
  currentNode: null,
  timer: null,
  playToken: 0,
  offline: false,
  started: false,
  pollTimer: null,
  heartbeatTimer: null,
  controlsTimer: null,
  cacheDbPromise: null,
  objectUrls: new Map(),
  prefetching: false,
  lastError: null,
  lastHeartbeatAt: null,
  sampleMode: false,
  sampleCode: null,
  pairing: false,
  lastAttemptCode: null,
  autoReconnect: false,
  reconnectCode: null,
  reconnectTimer: null,
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function hardwareId() {
  let value = safeGet(STORAGE.hardwareId);
  if (value && value.length >= 8) return value;
  try {
    value = crypto.randomUUID();
  } catch {
    value = `hw-${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  safeSet(STORAGE.hardwareId, value);
  return value;
}

function setOffline(value) {
  runtime.offline = value;
  el.offline.hidden = !value;
  document.body.dataset.offline = value ? 'true' : 'false';
  if (value && runtime.currentItem?.content?.kind === 'url' && runtime.currentNode?.dataset.kind === 'url') {
    renderUrlOffline(runtime.currentNode, runtime.currentItem);
  }
}

function showPair(message = '', prefill = '') {
  stopPlayback();
  el.player.hidden = true;
  el.pair.hidden = false;
  document.body.classList.remove('playing');
  setOffline(false);
  el.pairCode.value = prefill;
  el.pairError.hidden = !message;
  el.pairError.textContent = message;
  el.pairRecover.hidden = true;
  setTimeout(() => el.pairCode.focus(), 50);
}

function showPlayer() {
  el.pair.hidden = true;
  el.player.hidden = false;
  document.body.classList.add('playing');
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || '연결하기';
  }
}

async function pair(code, auto = false, options = {}) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!normalized) {
    el.pairError.textContent = '등록 코드를 입력해 주세요.';
    el.pairError.hidden = false;
    return;
  }
  if (runtime.pairing) return;
  runtime.lastAttemptCode = normalized;
  runtime.pairing = true;
  setBusy(el.pairButton, true, '연결 중…');
  el.sampleConnect.disabled = true;
  el.pairRecover.disabled = true;
  el.pairRecover.hidden = true;
  el.pairError.hidden = true;
  try {
    const response = await fetch('/api/player/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: normalized,
        hardwareId: hardwareId(),
        takeover: options.takeover === true,
        screen: { width: window.screen?.width || innerWidth, height: window.screen?.height || innerHeight },
        userAgent: navigator.userAgent,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error || '등록 코드를 확인해 주세요.');
      error.status = response.status;
      error.sampleCode = data?.sampleCode || null;
      throw error;
    }
    const previousDevice = runtime.deviceId;
    runtime.token = data.token;
    runtime.deviceId = data.device?.id || null;
    clearInterval(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
    safeSet(STORAGE.token, data.token);
    if (runtime.deviceId) safeSet(STORAGE.deviceId, runtime.deviceId);
    safeSet(STORAGE.lastCode, normalized);
    if (previousDevice && previousDevice !== runtime.deviceId) {
      safeRemove(STORAGE.manifest);
      runtime.manifest = null;
      runtime.pendingManifest = null;
      await clearMediaCache();
    }
    showPlayer();
    startLoops();
    await fetchManifest({ initial: true });
  } catch (error) {
    let message = error.message;
    const sampleCode = error.sampleCode || runtime.sampleCode;
    if (error.status === 404 && sampleCode) {
      message = `${message} 샘플 기기 코드는 ${sampleCode}입니다. 아래 ‘샘플 코드로 연결’을 눌러 바로 시작할 수 있습니다.`;
    }
    if (!auto) {
      el.pairError.textContent = message;
      el.pairError.hidden = false;
    } else {
      showPair(message, normalized);
    }
    el.pairRecover.hidden = error.status !== 409;
  } finally {
    runtime.pairing = false;
    setBusy(el.pairButton, false);
    el.sampleConnect.disabled = false;
    el.pairRecover.disabled = false;
  }
}

function startAutoReconnect() {
  if (!runtime.autoReconnect || !runtime.reconnectCode || runtime.reconnectTimer) return;
  runtime.reconnectTimer = setInterval(async () => {
    if (runtime.token || runtime.pairing || !navigator.onLine) return;
    await pair(runtime.reconnectCode, true, { takeover: true });
  }, 15_000);
}

async function loadPlayerConfig() {
  try {
    const response = await fetch('/api/player/config', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    runtime.sampleMode = Boolean(config.sampleMode && config.sampleCode);
    runtime.sampleCode = config.sampleCode || null;
    if (runtime.sampleMode) {
      el.sampleHint.hidden = false;
      el.sampleCode.textContent = runtime.sampleCode;
      el.sampleConnect.textContent = `샘플 코드 ${runtime.sampleCode}로 연결`;
    }
  } catch {
    // The pairing screen still works without the demo hint.
  }
}

function startLoops() {
  if (runtime.started) return;
  runtime.started = true;
  runtime.pollTimer = setInterval(() => {
    reevaluateCachedSchedule();
    fetchManifest();
  }, POLL_MS);
  runtime.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  sendHeartbeat();
}

async function fetchManifest(options = {}) {
  if (!runtime.token) return;
  try {
    const response = await fetch('/api/player/manifest', {
      headers: { Authorization: `Bearer ${runtime.token}` },
      cache: 'no-store',
    });
    if (response.status === 401) {
      handleUnauthorized();
      return;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `서버 응답 오류 (${response.status})`);
    const manifest = data?.manifest;
    if (!manifest) throw new Error('재생목록 응답이 비어 있습니다.');
    setOffline(false);
    safeSet(STORAGE.manifest, JSON.stringify(manifest));
    el.error.hidden = true;
    acceptManifest(manifest, Boolean(options.initial));
    prefetchAssets(manifest);
  } catch (error) {
    runtime.lastError = error.message;
    setOffline(true);
    if (!runtime.manifest) {
      const cached = loadCachedManifest();
      if (cached) {
        runtime.manifest = cached;
        applyManifest(cached, true);
      } else {
        showError('서버에 연결하지 못했습니다', '캐시된 재생목록이 없습니다. 네트워크와 서버 상태를 확인한 뒤 다시 연결해 주세요.');
      }
    }
  }
}

function acceptManifest(manifest, initial) {
  if (!runtime.manifest || initial || !runtime.currentNode || runtime.queue.length === 0) {
    applyManifest(manifest, true);
    return;
  }
  const nextPlaylist = activePlaylist(manifest);
  const samePlayingPlaylist = runtime.playlistId && runtime.playlistId === nextPlaylist?.id;
  if (manifest.version === runtime.manifest.version && samePlayingPlaylist) {
    runtime.manifest = manifest;
    return;
  }
  runtime.pendingManifest = manifest;
}

function reevaluateCachedSchedule() {
  const manifest = runtime.manifest;
  if (!manifest || !runtime.token || el.player.hidden) return;
  const playlist = activePlaylist(manifest);
  const queue = queueFor(playlist);
  if (!playlist || queue.length === 0) {
    if (!runtime.currentNode) return;
    stopPlayback();
    if (!playlist) showWaitingState(manifest);
    else el.empty.hidden = false;
    return;
  }
  const currentIsActive = queue.some((item) => item.content.id === runtime.currentContentId);
  if (!runtime.currentNode || runtime.playlistId !== playlist.id || !currentIsActive) {
    applyManifest(manifest, true);
  }
}

function activePlaylist(manifest) {
  if (!manifest) return null;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  for (const schedule of manifest.schedules || []) {
    if (!schedule.enabled || !Array.isArray(schedule.days)) continue;
    const start = parseTime(schedule.startTime);
    const end = parseTime(schedule.endTime);
    if (start < 0 || end < 0) continue;
    let applies = false;
    if (start <= end) {
      applies = schedule.days.includes(day) && minutes >= start && minutes < end;
    } else if (minutes >= start) {
      applies = schedule.days.includes(day);
    } else if (minutes < end) {
      applies = schedule.days.includes((day + 6) % 7);
    }
    if (applies) return schedule.playlist;
  }
  return manifest.defaultPlaylist;
}

function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function queueFor(playlist) {
  return (playlist?.items || []).filter((item) => item.enabled && item.content?.url);
}

function applyManifest(manifest, restart) {
  runtime.manifest = manifest;
  runtime.pendingManifest = null;
  hideCenter();
  el.error.hidden = true;
  el.deviceLabel.textContent = manifest.device?.name || '';
  safeSet(STORAGE.deviceId, manifest.device?.id || runtime.deviceId || '');
  if (manifest.version === 0 && !manifest.defaultPlaylist && !(manifest.schedules || []).length) {
    stopPlayback();
    showWaitingState(manifest);
    return;
  }
  const playlist = activePlaylist(manifest);
  const queue = queueFor(playlist);
  if (!playlist || queue.length === 0) {
    stopPlayback();
    if (!playlist) showWaitingState(manifest);
    else el.empty.hidden = false;
    return;
  }
  const changedPlaylist = runtime.playlistId !== playlist.id;
  runtime.queue = queue;
  if (restart || changedPlaylist || !runtime.currentNode) {
    runtime.playlistId = playlist.id;
    runtime.index = 0;
    playCurrent();
    return;
  }
  runtime.playlistId = playlist.id;
  const currentIndex = queue.findIndex((item) => item.content.id === runtime.currentContentId);
  if (currentIndex < 0) {
    runtime.index = 0;
    playCurrent();
  }
}

function hideCenter() {
  el.waiting.hidden = true;
  el.empty.hidden = true;
}

function showError(title, message) {
  stopPlayback();
  hideCenter();
  el.errorTitle.textContent = title;
  el.errorMessage.textContent = message;
  el.error.hidden = false;
}

function showWaitingState(manifest) {
  const scheduled = (manifest?.schedules || []).some((schedule) => schedule.enabled);
  if (manifest?.version === 0 || !scheduled) {
    el.waitingTitle.textContent = '관리자 게시를 기다리는 중';
    el.waitingMessage.textContent = '관리 화면에서 재생목록을 기기에 배정하고 게시를 눌러 주세요.';
  } else {
    el.waitingTitle.textContent = '예약 시간을 기다리는 중';
    el.waitingMessage.textContent = '현재 시간에 해당하는 예약 재생목록이 없습니다. 예약 시간이 되면 자동으로 시작합니다.';
  }
  el.waiting.hidden = false;
}

function stopPlayback() {
  runtime.playToken += 1;
  clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.queue = [];
  runtime.currentContentId = null;
  runtime.currentItem = null;
  document.body.removeAttribute('data-current-content-id');
  if (runtime.currentNode) {
    runtime.currentNode.remove();
    runtime.currentNode = null;
  }
}

function advance() {
  clearTimeout(runtime.timer);
  runtime.timer = null;
  if (runtime.pendingManifest) {
    applyManifest(runtime.pendingManifest, true);
    return;
  }
  const playlist = activePlaylist(runtime.manifest);
  if (!playlist) {
    stopPlayback();
    if ((runtime.manifest?.schedules || []).some((schedule) => schedule.enabled)) showWaitingState(runtime.manifest);
    else if (runtime.manifest?.version === 0) showWaitingState(runtime.manifest);
    else el.empty.hidden = false;
    return;
  }
  if (runtime.playlistId && playlist.id !== runtime.playlistId) {
    applyManifest(runtime.manifest, true);
    return;
  }
  const queue = queueFor(playlist);
  if (!queue.length) {
    stopPlayback();
    el.empty.hidden = false;
    return;
  }
  runtime.queue = queue;
  runtime.index = (runtime.index + 1) % queue.length;
  playCurrent();
}

async function playCurrent() {
  const token = ++runtime.playToken;
  clearTimeout(runtime.timer);
  runtime.timer = null;
  const item = runtime.queue[runtime.index];
  if (!item) {
    stopPlayback();
    el.empty.hidden = false;
    return;
  }
  hideCenter();
  runtime.currentItem = item;
  runtime.currentContentId = item.content.id;
  document.body.dataset.currentContentId = item.content.id;
  runtime.lastError = null;
  try {
    if (item.content.kind === 'url') {
      playUrl(item, token);
      return;
    }
    const source = await resolveMediaUrl(item.content);
    if (token !== runtime.playToken) return;
    if (!source) throw new Error('콘텐츠 주소가 없습니다.');
    if (item.content.kind === 'image') playImage(item, source, token);
    else playVideo(item, source, token);
  } catch (error) {
    if (token !== runtime.playToken) return;
    failItem(item, error.message);
  }
}

function playImage(item, source, token) {
  const node = document.createElement('div');
  node.className = 'slide';
  node.dataset.kind = 'image';
  let settled = false;
  const image = document.createElement('img');
  image.alt = item.content.name || '';
  image.style.objectFit = fitCss(item.fitMode);
  image.addEventListener('load', () => {
    if (token !== runtime.playToken) return;
    settled = true;
    commitNode(node, item.transitionMs);
    runtime.timer = setTimeout(advance, Math.max(2, item.durationSeconds) * 1000);
  }, { once: true });
  image.addEventListener('error', () => {
    if (token !== runtime.playToken) return;
    if (settled) return;
    settled = true;
    failItem(item, '이미지를 불러오지 못했습니다.');
  }, { once: true });
  image.src = source;
  node.appendChild(image);
  setTimeout(() => {
    if (token === runtime.playToken && !settled) {
      settled = true;
      failItem(item, '이미지 로딩 시간이 초과되었습니다.');
    }
  }, 20_000);
}

function playVideo(item, source, token) {
  const node = document.createElement('div');
  node.className = 'slide';
  node.dataset.kind = 'video';
  const video = document.createElement('video');
  video.src = source;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.objectFit = fitCss(item.fitMode);
  let committed = false;
  let failed = false;
  const commit = () => {
    if (committed || failed || token !== runtime.playToken) return;
    committed = true;
    commitNode(node, item.transitionMs);
    video.play().catch(() => {
      video.muted = true;
      video.play().catch((error) => {
        if (token === runtime.playToken) failItem(item, `동영상을 재생하지 못했습니다: ${error.message}`);
      });
    });
    runtime.timer = setTimeout(advance, 15 * 60 * 1000);
  };
  video.addEventListener('loadeddata', commit, { once: true });
  video.addEventListener('canplay', commit, { once: true });
  video.addEventListener('ended', () => {
    if (token === runtime.playToken) advance();
  });
  video.addEventListener('error', () => {
    if (token === runtime.playToken && !failed) {
      failed = true;
      failItem(item, '동영상을 불러오지 못했습니다.');
    }
  }, { once: true });
  node.appendChild(video);
  setTimeout(() => {
    if (token === runtime.playToken && !committed && !failed) {
      failed = true;
      failItem(item, '동영상 로딩 시간이 초과되었습니다.');
    }
  }, 20_000);
}

function playUrl(item, token) {
  const node = document.createElement('div');
  node.className = 'slide';
  node.dataset.kind = 'url';
  if (runtime.offline) {
    renderUrlOffline(node, item);
  } else {
    const frame = document.createElement('iframe');
    frame.src = item.content.url;
    frame.title = item.content.name || 'URL 콘텐츠';
    frame.loading = 'eager';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    node.appendChild(frame);
  }
  if (token !== runtime.playToken) return;
  commitNode(node, item.transitionMs);
  runtime.timer = setTimeout(advance, Math.max(3, item.durationSeconds) * 1000);
}

function renderUrlOffline(node, item) {
  node.innerHTML = `<div class="url-offline"><div class="url-offline-inner"><div class="mark">◫</div><h2>${escapeHtml(item.content.name || 'URL 콘텐츠')}</h2><p>웹 안내 화면은 네트워크 연결이 필요합니다. 연결이 돌아오면 자동으로 다시 표시됩니다.</p></div></div>`;
}

function commitNode(node, transitionMs) {
  const previous = runtime.currentNode;
  runtime.currentNode = node;
  node.style.transitionDuration = `${Math.max(0, Number(transitionMs) || 0)}ms`;
  el.stage.appendChild(node);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => node.classList.add('visible'));
  });
  if (previous && previous !== node) {
    previous.classList.remove('visible');
    setTimeout(() => previous.remove(), Math.max(0, Number(transitionMs) || 0) + 120);
  }
  document.body.classList.add('playing');
  revealControls();
}

function fitCss(fitMode) {
  if (fitMode === 'cover') return 'cover';
  if (fitMode === 'stretch') return 'fill';
  return 'contain';
}

function failItem(item, message) {
  runtime.lastError = `${item.content.name}: ${message}`;
  console.warn('[signage]', runtime.lastError);
  if (runtime.offline) setOffline(true);
  clearTimeout(runtime.timer);
  runtime.timer = setTimeout(advance, 1800);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function sendHeartbeat() {
  if (!runtime.token) return;
  try {
    const response = await fetch('/api/player/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.token}` },
      body: JSON.stringify({
        state: runtime.offline ? 'offline' : runtime.currentNode ? 'playing' : 'waiting',
        currentContentId: runtime.currentContentId,
        error: runtime.lastError,
      }),
    });
    if (response.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!response.ok) throw new Error(`heartbeat ${response.status}`);
    runtime.lastHeartbeatAt = new Date().toISOString();
  } catch {
    setOffline(true);
  }
}

function handleUnauthorized() {
  safeRemove(STORAGE.token);
  runtime.token = null;
  showPair('재생기 연결이 만료되었습니다. 관리 화면의 등록 코드를 다시 입력해 주세요.', safeGet(STORAGE.lastCode) || '');
}

function loadCachedManifest() {
  const raw = safeGet(STORAGE.manifest);
  if (!raw) return null;
  try {
    const manifest = JSON.parse(raw);
    if (manifest && Array.isArray(manifest.schedules)) return manifest;
  } catch { /* ignore */ }
  return null;
}

/* ---------------- Media cache (IndexedDB) ---------------- */
function openCacheDb() {
  if (runtime.cacheDbPromise) return runtime.cacheDbPromise;
  runtime.cacheDbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB를 사용할 수 없습니다.')); return; }
    const request = indexedDB.open('gugak-signage-media', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('캐시 DB를 열지 못했습니다.'));
  });
  return runtime.cacheDbPromise;
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('캐시 처리에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error || new Error('캐시 처리가 취소되었습니다.'));
  });
}

async function getCachedBlob(id) {
  const db = await openCacheDb();
  const tx = db.transaction('media', 'readonly');
  const request = tx.objectStore('media').get(id);
  const value = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  return value?.blob || null;
}

async function putCachedBlob(id, blob, content) {
  const db = await openCacheDb();
  const tx = db.transaction('media', 'readwrite');
  tx.objectStore('media').put({ id, blob, mime: content.mime || blob.type, url: content.url, cachedAt: new Date().toISOString() });
  await transactionPromise(tx);
}

async function resolveMediaUrl(content) {
  if (content.kind === 'url') return content.url;
  if (runtime.objectUrls.has(content.id)) return runtime.objectUrls.get(content.id);
  try {
    const blob = await getCachedBlob(content.id);
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      runtime.objectUrls.set(content.id, objectUrl);
      return objectUrl;
    }
  } catch { /* fall through to network */ }
  return content.url;
}

function collectContents(manifest) {
  const map = new Map();
  const visit = (playlist) => {
    for (const item of playlist?.items || []) {
      if (!item.enabled || !item.content?.url) continue;
      if (item.content.kind !== 'image' && item.content.kind !== 'video') continue;
      map.set(item.content.id, item.content);
    }
  };
  visit(manifest.defaultPlaylist);
  for (const schedule of manifest.schedules || []) visit(schedule.playlist);
  return [...map.values()];
}

async function prefetchAssets(manifest) {
  if (runtime.prefetching) return;
  runtime.prefetching = true;
  const contents = collectContents(manifest);
  const activeIds = new Set(contents.map((content) => content.id));
  try {
    const db = await openCacheDb();
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const request = tx.objectStore('media').getAllKeys();
      request.onsuccess = () => resolve(new Set(request.result.map(String)));
      request.onerror = () => reject(request.error);
    });
    for (const content of contents) {
      if (!runtime.token) break;
      if (existing.has(content.id)) continue;
      try {
        const response = await fetch(content.url, { cache: 'default' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (blob.size === 0) continue;
        await putCachedBlob(content.id, blob, content);
        existing.add(content.id);
      } catch {
        // A single asset failure must not stop the playlist.
      }
    }
    const stale = [...existing].filter((id) => !activeIds.has(id));
    if (stale.length) {
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      for (const id of stale) store.delete(id);
      await transactionPromise(tx);
    }
    revokeUnusedObjectUrls(activeIds, runtime.currentContentId);
  } catch (error) {
    console.warn('[signage] 콘텐츠 캐시를 준비하지 못했습니다.', error);
  } finally {
    runtime.prefetching = false;
  }
}

function revokeUnusedObjectUrls(activeIds, keepContentId) {
  for (const [contentId, objectUrl] of runtime.objectUrls) {
    if (activeIds.has(contentId) || contentId === keepContentId) continue;
    URL.revokeObjectURL(objectUrl);
    runtime.objectUrls.delete(contentId);
  }
}

async function clearMediaCache() {
  try {
    const db = await openCacheDb();
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').clear();
    await transactionPromise(tx);
    for (const url of runtime.objectUrls.values()) URL.revokeObjectURL(url);
    runtime.objectUrls.clear();
  } catch { /* ignore */ }
}

/* ---------------- Controls ---------------- */
function revealControls() {
  el.controls.hidden = false;
  el.controls.classList.remove('faded');
  clearTimeout(runtime.controlsTimer);
  runtime.controlsTimer = setTimeout(() => {
    el.controls.classList.add('faded');
    setTimeout(() => { if (el.controls.classList.contains('faded')) el.controls.hidden = true; }, 450);
  }, 3500);
}

el.pairForm.addEventListener('submit', (event) => {
  event.preventDefault();
  pair(el.pairCode.value);
});

el.pairCode.addEventListener('input', () => {
  el.pairCode.value = el.pairCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

el.sampleConnect.addEventListener('click', () => {
  if (!runtime.sampleCode) return;
  el.pairCode.value = runtime.sampleCode;
  pair(runtime.sampleCode);
});

el.pairRecover.addEventListener('click', () => {
  const code = runtime.lastAttemptCode || el.pairCode.value;
  pair(code, false, { takeover: true });
});

el.retry.addEventListener('click', async () => {
  if (!runtime.token) { showPair(); return; }
  el.error.hidden = true;
  await fetchManifest({ initial: !runtime.manifest });
});

el.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* kiosk mode may already be full screen */ }
  revealControls();
});

el.disconnect.addEventListener('click', async () => {
  if (!confirm('이 재생기의 연결 정보와 캐시를 지울까요? 관리 화면에서 기기를 다시 연결해야 합니다.')) return;
  safeRemove(STORAGE.token);
  safeRemove(STORAGE.manifest);
  safeRemove(STORAGE.deviceId);
  runtime.token = null;
  runtime.manifest = null;
  runtime.pendingManifest = null;
  await clearMediaCache();
  runtime.started = false;
  clearInterval(runtime.pollTimer);
  clearInterval(runtime.heartbeatTimer);
  showPair('연결 정보를 지웠습니다. 등록 코드를 다시 입력해 주세요.');
});

document.addEventListener('mousemove', () => { if (!el.player.hidden) revealControls(); });
document.addEventListener('touchstart', () => { if (!el.player.hidden) revealControls(); }, { passive: true });
window.addEventListener('online', () => {
  if (!runtime.token && runtime.autoReconnect) {
    void pair(runtime.reconnectCode, true, { takeover: true });
  }
  fetchManifest();
  sendHeartbeat();
});
window.addEventListener('offline', () => setOffline(true));

window.__signagePlayer = {
  getState() {
    return {
      deviceId: runtime.deviceId,
      manifestVersion: runtime.manifest?.version ?? null,
      playlistId: runtime.playlistId,
      queueLength: runtime.queue.length,
      index: runtime.index,
      currentContentId: runtime.currentContentId,
      offline: runtime.offline,
      lastError: runtime.lastError,
      lastHeartbeatAt: runtime.lastHeartbeatAt,
    };
  },
};

async function init() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').trim();
  runtime.autoReconnect = params.get('reconnect') === '1';
  runtime.reconnectCode = code;
  await loadPlayerConfig();
  const cached = loadCachedManifest();
  if (cached && runtime.token) {
    runtime.manifest = cached;
    showPlayer();
    applyManifest(cached, true);
  }
  const storedCode = safeGet(STORAGE.lastCode);
  const codeMatchesPairedDevice = Boolean(runtime.token) && (!storedCode || storedCode === code.toUpperCase());
  if (code && !codeMatchesPairedDevice) {
    showPair('', code);
    await pair(code, true, { takeover: runtime.autoReconnect });
    if (!runtime.token) startAutoReconnect();
    return;
  }
  if (runtime.token) {
    showPlayer();
    startLoops();
    await fetchManifest({ initial: !runtime.manifest });
  } else {
    showPair('', safeGet(STORAGE.lastCode) || '');
    startAutoReconnect();
  }
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* optional offline shell */ });
}

init().catch((error) => {
  console.error(error);
  showError('재생기를 시작하지 못했습니다', error.message);
});
