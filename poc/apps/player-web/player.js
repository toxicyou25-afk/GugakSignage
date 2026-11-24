// SPDX-License-Identifier: Apache-2.0
import { buildRenderPlan } from '/engine/index.js';
import { FadeRenderer } from '/shared/render.js';

const params = new URLSearchParams(location.search);
const HARDWARE_KEY = 'gugak.signage.hardware.v1';
const LINK_KEY = 'gugak.signage.links.v1';
const CLOCK_PREFIX = 'gugak.signage.clock.v1';
const MANIFEST_PREFIX = 'gugak.signage.manifest.v1';
const HEARTBEAT_MS = 30_000;
const MANIFEST_POLL_MS = 5_000;
const CLOCK_RESYNC_MS = 30_000;

const ui = {
  stage: document.querySelector('#stage'),
  layerA: document.querySelector('#layer-a'),
  layerB: document.querySelector('#layer-b'),
  placeholder: document.querySelector('#placeholder'),
  offlineBadge: document.querySelector('#offline-badge'),
  boot: document.querySelector('#boot'),
  bootText: document.querySelector('#boot-text'),
  register: document.querySelector('#register'),
  form: document.querySelector('#register-form'),
  siteKey: document.querySelector('#site-key'),
  displayId: document.querySelector('#display-id'),
  registerMessage: document.querySelector('#register-message'),
  debug: document.querySelector('#debug'),
  debugText: document.querySelector('#debug-text'),
  toast: document.querySelector('#toast'),
  fullscreen: document.querySelector('#fullscreen'),
  hint: document.querySelector('#hint'),
};

const state = {
  siteId: params.get('site') ?? null,
  displayId: params.get('display') ?? null,
  manifest: null,
  images: new Map(),
  clock: null,
  renderer: null,
  currentPlan: null,
  currentImage: null,
  lastRender: null,
  events: [],
  online: false,
  ready: false,
  registered: false,
  connecting: false,
  removed: false,
  debugVisible: params.has('debug'),
  lastSyncAt: 0,
  lastSyncInfo: null,
  lastHeartbeatAt: 0,
  lastManifestAt: 0,
  boundaryTimer: null,
  tickTimer: null,
  toastTimer: null,
  error: null,
  swControlled: false,
};

function hardwareId() {
  try {
    const existing = localStorage.getItem(HARDWARE_KEY);
    if (existing) return existing;
    const next = `browser-${crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    localStorage.setItem(HARDWARE_KEY, next);
    return next;
  } catch {
    return `ephemeral-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function manifestCacheKey(siteId, displayId) {
  return `${MANIFEST_PREFIX}|${siteId}|${displayId}`;
}

function clockCacheKey() {
  return `${CLOCK_PREFIX}|${location.origin}`;
}

function readJsonStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled localStorage must not stop playback.
  }
}

function cacheManifest(manifest) {
  if (!manifest?.site?.id || !manifest?.displayId) return;
  writeJsonStorage(manifestCacheKey(manifest.site.id, manifest.displayId), {
    savedAt: Date.now(),
    manifest,
  });
}

function readCachedManifest(siteId, displayId) {
  return readJsonStorage(manifestCacheKey(siteId, displayId), null);
}

function saveLink() {
  if (!state.siteId || !state.displayId) return;
  const links = readJsonStorage(LINK_KEY, {});
  links[state.displayId] = {
    siteId: state.siteId,
    displayId: state.displayId,
    url: `/player/?site=${encodeURIComponent(state.siteId)}&display=${encodeURIComponent(state.displayId)}`,
    updatedAt: Date.now(),
  };
  writeJsonStorage(LINK_KEY, links);
}

function setBoot(text) {
  ui.bootText.textContent = text;
  ui.boot.hidden = false;
}

function hideBoot() {
  ui.boot.hidden = true;
}

function showToast(message, duration = 6000) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, duration);
}

function showRegister(message = '') {
  hideBoot();
  ui.register.hidden = false;
  ui.registerMessage.textContent = message;
  if (state.siteId) ui.siteKey.value = state.siteId;
  if (state.displayId) ui.displayId.value = state.displayId;
  setTimeout(() => ui.siteKey.focus(), 50);
}

function hideRegister() {
  ui.register.hidden = true;
}

function setOnline(online) {
  state.online = Boolean(online);
  ui.offlineBadge.hidden = Boolean(online) || !state.manifest;
  if (!online && state.manifest) {
    ui.offlineBadge.textContent = 'OFFLINE · 마지막 콘텐츠 재생 중';
  }
}

class ServerClock {
  constructor() {
    const saved = readJsonStorage(clockCacheKey(), null);
    this.offsetMs = Number.isFinite(saved?.offsetMs) ? saved.offsetMs : 0;
    this.previousOffsetMs = this.offsetMs;
    this.lastDriftMs = 0;
    this.rttMs = Number.isFinite(saved?.rttMs) ? saved.rttMs : null;
    this.syncedAtWall = Number.isFinite(saved?.syncedAtWall) ? saved.syncedAtWall : null;
    this.syncCount = Number.isInteger(saved?.syncCount) ? saved.syncCount : 0;
    this.anchorPerf = performance.now();
    this.anchorServer = Date.now() + this.offsetMs;
    this.samples = [];
  }

  now() {
    return this.anchorServer + (performance.now() - this.anchorPerf);
  }

  status() {
    return {
      offsetMs: this.offsetMs,
      driftMs: this.lastDriftMs,
      rttMs: this.rttMs,
      syncedAtWall: this.syncedAtWall,
      syncCount: this.syncCount,
      ageMs: this.syncedAtWall ? Date.now() - this.syncedAtWall : null,
      samples: this.samples.map((sample) => ({ rttMs: sample.rttMs, offsetMs: sample.offsetMs })),
    };
  }

  async sync(sampleCount = 8) {
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const t0 = Date.now();
      const p0 = performance.now();
      const response = await fetch(`/api/time?nonce=${Date.now()}-${index}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Time sample failed: HTTP ${response.status}`);
      const body = await response.json();
      const t1 = Date.now();
      const p1 = performance.now();
      const serverTime = Number(body.serverTime ?? body.now);
      if (!Number.isFinite(serverTime)) throw new Error('Time sample has no serverTime');
      const rttMs = Math.max(0, p1 - p0);
      const offsetMs = serverTime - (t0 + t1) / 2;
      samples.push({ rttMs, offsetMs, serverTime, t0, t1 });
    }
    const best = samples.reduce((current, sample) => (current.rttMs <= sample.rttMs ? current : sample), samples[0]);
    const hadPrevious = this.syncedAtWall !== null;
    this.previousOffsetMs = this.offsetMs;
    this.offsetMs = best.offsetMs;
    this.lastDriftMs = hadPrevious ? this.offsetMs - this.previousOffsetMs : 0;
    this.rttMs = best.rttMs;
    this.syncCount = samples.length;
    this.samples = samples;
    this.syncedAtWall = Date.now();
    this.anchorPerf = performance.now();
    this.anchorServer = Date.now() + this.offsetMs;
    writeJsonStorage(clockCacheKey(), {
      offsetMs: this.offsetMs,
      rttMs: this.rttMs,
      syncedAtWall: this.syncedAtWall,
      syncCount: this.syncCount,
    });
    return { best, samples, offsetMs: this.offsetMs, driftMs: this.lastDriftMs, rttMs: this.rttMs };
  }
}

function imageSrc(image, version) {
  const url = new URL(image.displayUrl, location.origin);
  if (version) url.searchParams.set('v', String(version));
  return url.href;
}

async function preloadImages(manifest) {
  const next = new Map();
  await Promise.all(
    (manifest.images ?? []).map(async (image) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = imageSrc(image, manifest.version);
      const loaded = await new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) return resolve(true);
        const timer = setTimeout(() => resolve(false), 10_000);
        img.onload = () => {
          clearTimeout(timer);
          resolve(true);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });
      if (loaded) next.set(image.id, img);
    }),
  );
  return next;
}

function imageForPlan(plan) {
  if (!plan?.imageId) return null;
  return state.images.get(plan.imageId) ?? null;
}

function buildCurrentPlan() {
  if (!state.manifest || !state.clock) return null;
  return buildRenderPlan(state.manifest, state.displayId, state.clock.now());
}

function logRender(plan, appliedAtMs, reason) {
  const event = {
    type: 'render',
    reason,
    displayId: state.displayId,
    imageId: plan.imageId,
    imageIndex: plan.imageIndex,
    slot: plan.slot,
    slotStartMs: plan.slotStartMs,
    appliedAtMs,
    lagMs: appliedAtMs - plan.slotStartMs,
    transitionMs: plan.transitionMs,
    fit: plan.fit,
    rotation: plan.rotation,
    version: state.manifest?.version ?? null,
    at: new Date(appliedAtMs).toISOString(),
    initial: state.events.length === 0,
  };
  state.lastRender = event;
  state.events.push(event);
  if (state.events.length > 1000) state.events.splice(0, state.events.length - 1000);
}

function scheduleBoundary(plan) {
  if (state.boundaryTimer) clearTimeout(state.boundaryTimer);
  state.boundaryTimer = null;
  if (!plan?.nextChangeAtMs || !state.clock) return;
  const delay = Math.max(0, plan.nextChangeAtMs - state.clock.now());
  state.boundaryTimer = setTimeout(() => {
    tick('boundary');
    requestAnimationFrame(() => tick('raf'));
  }, Math.min(delay + 6, 2_147_000_000));
}

function tick(reason = 'interval') {
  if (!state.manifest || !state.clock) return;
  let plan;
  try {
    plan = buildCurrentPlan();
  } catch (error) {
    state.error = error.message;
    showToast(`재생 계획을 만들 수 없습니다: ${error.message}`, 8000);
    return;
  }
  const appliedAtMs = state.clock.now();
  const image = imageForPlan(plan);
  const changed = state.renderer.show(plan, image, {});
  if (changed) logRender(plan, appliedAtMs, reason);
  state.currentPlan = plan;
  state.currentImage = image;
  ui.placeholder.hidden = !plan.placeholder;
  scheduleBoundary(plan);
  updateDebug();
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString('ko-KR', { hour12: false });
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 0) return '지남';
  return `${(ms / 1000).toFixed(1)}s`;
}

function updateDebug() {
  if (!state.debugVisible) return;
  ui.debug.hidden = false;
  const plan = state.currentPlan;
  const clock = state.clock?.status?.() ?? {};
  const now = state.clock?.now?.() ?? Date.now();
  const lines = [
    'GUGANG SIGN · PLAYER DEBUG',
    `display   ${state.displayId ?? '—'}   site ${state.siteId ?? '—'}   v${state.manifest?.version ?? '—'}`,
    `mode      ${plan?.mode ?? '—'}   fit ${plan?.fit ?? '—'}   rotation ${plan?.rotation ?? '—'}°`,
    `image     #${plan?.imageIndex ?? '—'}/${plan?.imageCount ?? '—'}   ${plan?.imageId ?? (plan?.placeholder ? 'PLACEHOLDER' : '—')}`,
    `slot      ${plan?.slot ?? '—'}   offset ${Math.round(plan?.offsetMs ?? 0)}ms   ${plan?.slotId ?? 'no slot'}`,
    `drift     ${Math.round(clock.driftMs ?? 0)}ms (offset change)   render lag ${Math.round(state.lastRender?.lagMs ?? 0)}ms`,
    `clock     offset ${Math.round(clock.offsetMs ?? 0)}ms   rtt ${clock.rttMs == null ? '—' : Math.round(clock.rttMs)}ms   age ${clock.ageMs == null ? '—' : Math.round(clock.ageMs / 1000)}s   samples ${clock.syncCount ?? 0}/8`,
    `viewport  ${plan?.viewport?.width ?? '—'}×${plan?.viewport?.height ?? '—'}   next ${formatTime(plan?.nextChangeAtMs)} (${formatCountdown((plan?.nextChangeAtMs ?? now) - now)})`,
    `network   ${state.online ? 'ONLINE' : 'OFFLINE'}   sw ${state.swControlled ? 'controlled' : 'not yet'}   cache ${state.manifest ? 'yes' : 'no'}`,
    `events    ${state.events.length}   server ${formatTime(state.lastManifestAt)}   error ${state.error ?? '—'}`,
  ];
  ui.debugText.textContent = lines.join('\n');
}

function clientResolution() {
  const width = Math.round((window.screen?.width || window.innerWidth) * (window.devicePixelRatio || 1));
  const height = Math.round((window.screen?.height || window.innerHeight) * (window.devicePixelRatio || 1));
  return { width, height };
}

async function registerExisting() {
  if (!state.siteId || !state.displayId) throw new Error('site and display are required');
  const resolution = clientResolution();
  const response = await fetch('/api/displays/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      siteId: state.siteId,
      displayId: state.displayId,
      hardwareId: hardwareId(),
      resolution,
      orientation: resolution.width >= resolution.height ? 'landscape' : 'portrait',
      userAgent: navigator.userAgent,
      capabilities: ['browser', 'offline-cache', 'two-canvas-fade'],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message ?? `Registration failed (HTTP ${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  state.siteId = body.siteId;
  state.displayId = body.displayId;
  state.registered = true;
  saveLink();
  return body;
}

async function fetchManifest() {
  const url = new URL(`/api/sites/${encodeURIComponent(state.siteId)}/manifest`, location.origin);
  url.searchParams.set('displayId', state.displayId);
  url.searchParams.set('_', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message ?? `Manifest failed (HTTP ${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function syncClock() {
  if (!state.clock) return null;
  const result = await state.clock.sync(8);
  state.lastSyncInfo = result;
  state.lastSyncAt = Date.now();
  return result;
}

async function sendHeartbeat() {
  if (!state.registered || !state.displayId) return;
  const plan = state.currentPlan;
  const response = await fetch(`/api/displays/${encodeURIComponent(state.displayId)}/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientTime: Date.now(),
      imageId: plan?.imageId ?? null,
      imageIndex: plan?.imageIndex ?? null,
      slot: plan?.slot ?? null,
      mode: plan?.mode ?? null,
      fit: plan?.fit ?? null,
      offline: !state.online,
    }),
  });
  if (response.ok) {
    state.lastHeartbeatAt = Date.now();
    return;
  }
  if (response.status === 404) {
    state.registered = false;
    state.removed = true;
    state.error = '이 화면은 서버에서 제거되었습니다.';
    showToast('이 화면이 서버에서 제거되었습니다. 캐시된 콘텐츠를 계속 재생합니다.', 10_000);
  }
}

async function applyManifest(manifest, { fromCache = false } = {}) {
  const images = await preloadImages(manifest);
  state.manifest = manifest;
  state.images = images;
  state.siteId = manifest.site?.id ?? state.siteId;
  state.displayId = manifest.displayId ?? state.displayId;
  state.lastManifestAt = Date.now();
  state.ready = true;
  state.removed = false;
  hideBoot();
  hideRegister();
  if (!fromCache) cacheManifest(manifest);
  saveLink();
  document.title = `${manifest.display?.name ?? state.displayId} · 국악원 사이니지`;
  tick(fromCache ? 'cache' : 'manifest');
}

async function attemptConnect() {
  if (!state.siteId || !state.displayId || state.connecting) return;
  state.connecting = true;
  try {
    if (!state.registered) await registerExisting();
    if (!state.clock) state.clock = new ServerClock();
    if (!state.lastSyncAt || Date.now() - state.lastSyncAt >= CLOCK_RESYNC_MS) {
      await syncClock();
    }
    const manifest = await fetchManifest();
    await applyManifest(manifest);
    setOnline(true);
    state.error = null;
    if (Date.now() - state.lastHeartbeatAt >= HEARTBEAT_MS) await sendHeartbeat();
    if (state.removed) setOnline(false);
  } catch (error) {
    state.error = error.message;
    setOnline(false);
    if (!state.manifest) {
      setBoot('서버에 연결할 수 없습니다. 캐시된 콘텐츠가 없습니다. 네트워크를 확인해 주세요.');
      if (error.statusCode === 404) showRegister('화면 링크를 찾을 수 없습니다. 사이트 키와 화면 ID를 확인해 주세요.');
    }
  } finally {
    state.connecting = false;
  }
}

function startLoops() {
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.tickTimer = setInterval(() => {
    if (!document.hidden) tick('interval');
  }, 250);
  setInterval(() => {
    if (!document.hidden) attemptConnect();
  }, MANIFEST_POLL_MS);
  setInterval(() => {
    if (!document.hidden) sendHeartbeat().catch(() => {});
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncClock().catch(() => {});
      attemptConnect();
      tick('visible');
    }
  });
  window.addEventListener('resize', () => {
    if (state.currentPlan) state.renderer.resize(state.currentPlan, state.currentImage);
  });
}

async function onRegisterSubmit(event) {
  event.preventDefault();
  ui.registerMessage.textContent = '연결하는 중…';
  const siteKey = ui.siteKey.value.trim();
  const displayIdValue = ui.displayId.value.trim();
  if (!siteKey) {
    ui.registerMessage.textContent = '사이트 키를 입력해 주세요.';
    return;
  }
  const resolution = clientResolution();
  try {
    const response = await fetch('/api/displays/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteKey,
        displayId: displayIdValue || undefined,
        hardwareId: hardwareId(),
        resolution,
        orientation: resolution.width >= resolution.height ? 'landscape' : 'portrait',
        userAgent: navigator.userAgent,
        capabilities: ['browser', 'offline-cache', 'two-canvas-fade'],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
    state.siteId = body.siteId;
    state.displayId = body.displayId;
    state.registered = true;
    saveLink();
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('site', body.siteId);
    nextUrl.searchParams.set('display', body.displayId);
    history.replaceState(null, '', nextUrl.href);
    hideRegister();
    setBoot('재생 목록을 불러오는 중…');
    await attemptConnect();
  } catch (error) {
    ui.registerMessage.textContent = `연결하지 못했습니다: ${error.message}`;
  }
}

function setDebug(visible) {
  state.debugVisible = Boolean(visible);
  ui.debug.hidden = !state.debugVisible;
  if (state.debugVisible) updateDebug();
}

async function boot() {
  state.renderer = new FadeRenderer([ui.layerA, ui.layerB], { background: '#060b13' });
  state.clock = new ServerClock();
  if (params.has('debug')) setDebug(true);
  ui.form.addEventListener('submit', onRegisterSubmit);
  ui.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') setDebug(!state.debugVisible);
    if (event.key === 'f' || event.key === 'F') ui.fullscreen.click();
    if (event.key === 'r' || event.key === 'R') attemptConnect();
  });
  setTimeout(() => ui.hint.classList.add('fade'), 12_000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/player/sw.js').then(() => {
      state.swControlled = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        state.swControlled = true;
        updateDebug();
      });
    }).catch(() => {});
  }
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {});

  if (!state.siteId || !state.displayId) {
    showRegister('');
    return;
  }
  const cached = readCachedManifest(state.siteId, state.displayId);
  if (cached?.manifest) {
    try {
      await applyManifest(cached.manifest, { fromCache: true });
    } catch (error) {
      state.error = error.message;
    }
  } else {
    setBoot('플레이어를 준비하는 중…');
  }
  startLoops();
  await attemptConnect();
}

window.__signage = {
  get ready() { return state.ready; },
  events: state.events,
  setDebug,
  forceSync: () => syncClock(),
  refresh: () => attemptConnect(),
  debugState: () => {
    const clock = state.clock?.status?.() ?? {};
    const plan = state.currentPlan;
    return {
      ready: state.ready,
      siteId: state.siteId,
      displayId: state.displayId,
      online: state.online,
      removed: state.removed,
      mode: plan?.mode ?? null,
      imageId: plan?.imageId ?? null,
      imageIndex: plan?.imageIndex ?? null,
      imageCount: plan?.imageCount ?? null,
      slot: plan?.slot ?? null,
      slotId: plan?.slotId ?? null,
      offsetMs: plan?.offsetMs ?? null,
      slotStartMs: plan?.slotStartMs ?? null,
      nextChangeAtMs: plan?.nextChangeAtMs ?? null,
      fit: plan?.fit ?? null,
      rotation: plan?.rotation ?? null,
      viewport: plan?.viewport ?? null,
      placeholder: plan?.placeholder ?? null,
      clockOffsetMs: clock.offsetMs ?? null,
      clockDriftMs: clock.driftMs ?? null,
      rttMs: clock.rttMs ?? null,
      syncCount: clock.syncCount ?? null,
      syncAgeMs: clock.ageMs ?? null,
      lastRender: state.lastRender,
      eventsCount: state.events.length,
      manifestVersion: state.manifest?.version ?? null,
      lastManifestAt: state.lastManifestAt,
      error: state.error,
      swControlled: state.swControlled,
      now: state.clock?.now?.() ?? null,
    };
  },
};

boot().catch((error) => {
  state.error = error.message;
  setBoot(`플레이어 시작 실패: ${error.message}`);
});
