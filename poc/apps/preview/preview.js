// SPDX-License-Identifier: Apache-2.0
import {
  assignDisplays,
  buildLayout,
  buildRenderPlan,
  createSnapshot,
  lcm,
  patternPreview,
  summarizeIssues,
  validateSnapshot,
} from '/engine/index.js';
import { drawPlanToCanvas } from '/shared/render.js';

const ui = {
  siteSelect: document.querySelector('#site-select'),
  refresh: document.querySelector('#refresh'),
  serverStatus: document.querySelector('#server-status'),
  siteMeta: document.querySelector('#site-meta'),
  siteName: document.querySelector('#site-name'),
  playPause: document.querySelector('#play-pause'),
  goLive: document.querySelector('#go-live'),
  timeLabel: document.querySelector('#time-label'),
  scrub: document.querySelector('#scrub'),
  slotLabel: document.querySelector('#slot-label'),
  boardWrap: document.querySelector('#board-wrap'),
  board: document.querySelector('#board'),
  unassigned: document.querySelector('#unassigned'),
  modeSelect: document.querySelector('#mode-select'),
  imageCount: document.querySelector('#image-count'),
  displayCount: document.querySelector('#display-count'),
  displayMinus: document.querySelector('#display-minus'),
  displayPlus: document.querySelector('#display-plus'),
  layoutSelect: document.querySelector('#layout-select'),
  fitSelect: document.querySelector('#fit-select'),
  scenarioNote: document.querySelector('#scenario-note'),
  warningCount: document.querySelector('#warning-count'),
  warnings: document.querySelector('#warnings'),
  clockState: document.querySelector('#clock-state'),
  stats: document.querySelector('#stats'),
  playerLinks: document.querySelector('#player-links'),
  patternCount: document.querySelector('#pattern-count'),
  patternTable: document.querySelector('#pattern-table'),
  toast: document.querySelector('#toast'),
};

const state = {
  sites: [],
  demo: null,
  site: null,
  group: null,
  snapshot: null,
  pattern: null,
  warnings: [],
  preloaded: new Map(),
  displayViews: new Map(),
  clockOffsetMs: 0,
  previewNow: Date.now(),
  playing: true,
  renderTimer: null,
  pollTimer: null,
  toastTimer: null,
  scenarioNote: '',
};

const MODE_LABELS = {
  individual: '개별 재생',
  'synchronized-cycle': '순환 동기화',
  mirror: '동시 재생',
  canvas: '통합 화면',
};

function serverNow() {
  return Date.now() + state.clockOffsetMs;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
  return body;
}

function showToast(message, duration = 5000) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, duration);
}

function setServerStatus(online, text) {
  ui.serverStatus.textContent = text;
  ui.serverStatus.classList.toggle('offline', !online);
}

function formatTime(ms) {
  return new Date(ms).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function escapeText(value) {
  return String(value ?? '');
}

function currentGroup() {
  return state.site?.groups?.[0] ?? null;
}

function currentDwellMs() {
  return state.group?.settings?.dwellMs ?? 10_000;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function preloadAllImages(site) {
  const map = new Map();
  const all = [...(state.demo?.images ?? []), ...(site?.images ?? [])];
  for (const image of all) map.set(image.id, image);
  const jobs = [...map.values()].map(async (image) => {
    const img = new Image();
    const url = new URL(image.displayUrl, location.origin);
    url.searchParams.set('v', 'preview');
    img.src = url.href;
    await new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      const timer = setTimeout(resolve, 8000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); resolve(); };
    });
    if (img.naturalWidth > 0) state.preloaded.set(image.id, img);
  });
  return Promise.all(jobs);
}

function chooseImages() {
  const choice = ui.imageCount.value;
  const siteImages = state.site?.images ?? [];
  const byId = new Map([...siteImages, ...(state.demo?.images ?? [])].map((image) => [image.id, image]));
  if (choice === 'site') {
    const items = state.group ? state.site.playlists.find((playlist) => playlist.id === state.group.playlistId)?.items ?? [] : [];
    return items.map((item) => byId.get(item.imageId)).filter(Boolean);
  }
  const count = Number(choice);
  const setName = count === 0 ? 'zero' : count === 1 ? 'one' : count === 3 ? 'three' : count === 10 ? 'ten' : null;
  const ids = setName ? state.demo?.imageSets?.[setName] ?? [] : [];
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function choosePlaylist(images) {
  const sitePlaylist = state.site?.playlists?.find((playlist) => playlist.id === state.group?.playlistId);
  if (ui.imageCount.value === 'site' && sitePlaylist) {
    const imageIds = new Set(images.map((image) => image.id));
    return {
      ...sitePlaylist,
      items: sitePlaylist.items.filter((item) => imageIds.has(item.imageId)),
    };
  }
  const dwell = currentDwellMs();
  return {
    id: 'preview-playlist',
    name: 'Preview scenario playlist',
    items: images.map((image, index) => ({
      id: `preview-item-${index + 1}`,
      imageId: image.id,
      durationMs: dwell,
      transitionMs: 400,
      enabled: true,
    })),
  };
}

function buildSyntheticDisplays(count) {
  const base = state.site?.displays ?? [];
  const fallback = {
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
    rotation: 0,
    status: 'online',
  };
  const dwell = currentDwellMs();
  return Array.from({ length: count }, (_, index) => {
    const template = base[index] ?? base[index % Math.max(1, base.length)] ?? fallback;
    const isBase = index < base.length;
    return {
      ...clone(template),
      id: isBase ? template.id : `${state.site?.id ?? 'site'}-preview-${index + 1}`,
      groupId: state.group?.id ?? 'preview-group',
      name: isBase ? template.name : `Preview ${index + 1}`,
      slotId: undefined,
      hardwareId: isBase ? template.hardwareId : `preview-hw-${index + 1}`,
      status: isBase ? template.status : 'online',
      startIndex: Number.isInteger(template.startIndex) ? template.startIndex : index,
      step: Number.isInteger(template.step) ? template.step : 1,
      startOffsetMs: ui.modeSelect.value === 'individual' ? index * dwell : undefined,
    };
  });
}

function customSlots(count) {
  const columns = count <= 4 ? 2 : count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const gap = 0.012;
  const w = (1 - gap * (columns - 1)) / columns;
  const h = (1 - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    id: `slot-${index + 1}`,
    x: Number(((index % columns) * (w + gap)).toFixed(6)),
    y: Number((Math.floor(index / columns) * (h + gap)).toFixed(6)),
    w: Number(w.toFixed(6)),
    h: Number(h.toFixed(6)),
  }));
}

function chooseLayout(displayCount) {
  const siteLayout = state.site?.layouts?.find((layout) => layout.id === state.group?.layoutId);
  const siteDisplayCount = state.site?.displays?.length ?? 0;
  const choice = ui.layoutSelect.value;
  if (choice === 'site' && siteLayout && displayCount === siteDisplayCount) {
    return { layout: clone(siteLayout), fallback: false, note: '' };
  }
  let type = choice;
  let fallback = false;
  let note = '';
  if (choice === 'site') {
    type = displayCount === 1 ? 'single' : displayCount <= 4 ? 'row' : 'grid';
    note = `장소 배치(${siteDisplayCount}면) 대신 ${displayCount}면용 ${type} 배치를 생성했습니다.`;
  }
  if (type === 'single' && displayCount !== 1) {
    type = 'row';
    fallback = true;
    note = 'single 배치는 1면만 지원하므로 가로 배치로 대체했습니다.';
  }
  if (type === 'custom') {
    const columns = displayCount <= 4 ? 2 : displayCount <= 6 ? 3 : 4;
    return {
      layout: buildLayout({
        id: 'preview-custom',
        name: 'Preview custom',
        type: 'custom',
        displayCount,
        slots: customSlots(displayCount),
        canvasWidth: columns * 1920,
        canvasHeight: Math.ceil(displayCount / columns) * 1080,
        gap: 0.012,
      }),
      fallback,
      note,
    };
  }
  return {
    layout: buildLayout({
      id: `preview-${type}`,
      name: `Preview ${type}`,
      type,
      displayCount,
      gap: 0.01,
      ...(type === 'grid' ? { columns: displayCount <= 6 ? 3 : 4 } : {}),
    }),
    fallback,
    note,
  };
}

function dedupe(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildScenario() {
  if (!state.site || !state.group) return;
  const group = currentGroup();
  state.group = group;
  const images = chooseImages();
  const playlist = choosePlaylist(images);
  const requestedCount = Math.min(12, Math.max(1, Math.round(Number(ui.displayCount.value) || 1)));
  ui.displayCount.value = String(requestedCount);
  const displays = buildSyntheticDisplays(requestedCount);
  const { layout, fallback, note } = chooseLayout(requestedCount);
  displays.forEach((display, index) => {
    display.slotId = layout.slots[index]?.id ?? undefined;
  });
  const mode = ui.modeSelect.value;
  const fit = ui.fitSelect.value;
  const settings = { ...(group.settings ?? {}), fit };
  const scenarioGroup = { ...group, playbackMode: mode, settings };
  const snapshot = createSnapshot({
    site: state.site,
    group: scenarioGroup,
    layout,
    playlist,
    displays,
    images,
    mode,
    epoch: group.epoch,
    dwellMs: settings.dwellMs ?? 10_000,
    settings,
  });
  const issues = [...validateSnapshot(snapshot)];
  if (requestedCount > (state.site.displays?.length ?? 0)) {
    issues.push({
      code: 'SYNTHETIC_DISPLAYS',
      severity: 'info',
      path: 'displays',
      message: `${requestedCount - state.site.displays.length} synthetic display(s) were added for this scenario.`,
    });
  }
  if (fallback) {
    issues.push({ code: 'LAYOUT_FALLBACK', severity: 'warning', path: 'layout', message: 'single layout was replaced by a row layout.' });
  }
  if (note) state.scenarioNote = note;
  else state.scenarioNote = `${MODE_LABELS[mode]} · 이미지 ${images.length}장 · 모니터 ${requestedCount}대 · ${layout.type}`;
  const pattern = patternPreview(snapshot, { maxSlots: 120 });
  state.snapshot = snapshot;
  state.pattern = pattern;
  state.warnings = dedupe(issues);
  renderWarnings();
  renderStats();
  renderPattern();
  buildBoard();
  ui.scenarioNote.textContent = state.scenarioNote;
  resetRange();
}

function renderWarnings() {
  const summary = summarizeIssues(state.warnings);
  ui.warningCount.textContent = summary.errors + summary.warnings + summary.info === 0
    ? '문제 없음'
    : `오류 ${summary.errors} · 경고 ${summary.warnings} · 정보 ${summary.info}`;
  ui.warnings.replaceChildren();
  if (state.warnings.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'ok-state';
    ok.textContent = '현재 시나리오에서 감지된 경고가 없습니다.';
    ui.warnings.append(ok);
    return;
  }
  for (const issue of state.warnings.slice(0, 40)) {
    const row = document.createElement('div');
    row.className = `warning ${issue.severity}`;
    const severity = document.createElement('span');
    severity.className = 'severity';
    severity.textContent = issue.severity;
    const code = document.createElement('code');
    code.textContent = issue.code;
    row.append(severity, code, document.createElement('br'), document.createTextNode(issue.message));
    ui.warnings.append(row);
  }
  if (state.warnings.length > 40) {
    const more = document.createElement('div');
    more.className = 'warning info';
    more.textContent = `외 ${state.warnings.length - 40}건`;
    ui.warnings.append(more);
  }
}

function renderStats() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const imageCount = snapshot.playlist.items.length;
  const displayCount = snapshot.displays.length;
  const period = state.pattern?.periodSlots ?? lcm(imageCount, displayCount);
  const dwell = snapshot.dwellMs ?? 10_000;
  ui.stats.innerHTML = '';
  const rows = [
    ['이미지 / 모니터', `${imageCount} / ${displayCount}`],
    ['패턴 주기', `${period} slots (LCM)`],
    ['epoch', formatTime(snapshot.epochMs)],
    ['dwell', `${(dwell / 1000).toFixed(1)}초`],
    ['layout', `${snapshot.layout.type} · ${snapshot.layout.slots.length} slots`],
    ['site key', state.site.siteKey ?? '—'],
  ];
  for (const [term, value] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    ui.stats.append(div);
  }
  ui.clockState.textContent = `clock ${state.clockOffsetMs >= 0 ? '+' : ''}${Math.round(state.clockOffsetMs)}ms`;
}

function buildBoard() {
  if (!state.snapshot) return;
  const { layout, displays } = state.snapshot;
  ui.board.style.aspectRatio = `${layout.canvasWidth} / ${layout.canvasHeight}`;
  const assignment = assignDisplays(layout, displays);
  ui.board.replaceChildren();
  state.displayViews.clear();
  for (const slot of assignment.slots) {
    const monitor = document.createElement('div');
    monitor.className = 'monitor';
    monitor.style.left = `${slot.x * 100}%`;
    monitor.style.top = `${slot.y * 100}%`;
    monitor.style.width = `${slot.w * 100}%`;
    monitor.style.height = `${slot.h * 100}%`;
    if (!slot.display) {
      monitor.classList.add('empty');
      monitor.title = `Empty slot ${slot.id}`;
      ui.board.append(monitor);
      continue;
    }
    const canvas = document.createElement('canvas');
    monitor.append(canvas);
    const label = document.createElement('div');
    label.className = 'monitor-label';
    monitor.append(label);
    ui.board.append(monitor);
    state.displayViews.set(slot.display.id, { monitor, canvas, label, display: slot.display, slot });
  }
  if (assignment.unassignedDisplays.length > 0) {
    ui.unassigned.hidden = false;
    ui.unassigned.textContent = `배치 슬롯이 없는 화면: ${assignment.unassignedDisplays.map((display) => display.id).join(', ')}`;
  } else {
    ui.unassigned.hidden = true;
  }
  requestAnimationFrame(drawBoard);
}

function drawBoard() {
  if (!state.snapshot) return;
  const now = state.previewNow;
  let firstPlan = null;
  for (const [displayId, view] of state.displayViews) {
    let plan;
    try {
      plan = buildRenderPlan(state.snapshot, displayId, now);
    } catch (error) {
      view.label.textContent = `${displayId} · ${error.message}`;
      continue;
    }
    if (!firstPlan) firstPlan = plan;
    const image = state.preloaded.get(plan.imageId);
    drawPlanToCanvas(view.canvas, plan, {
      image,
      width: Math.max(1, view.canvas.clientWidth),
      height: Math.max(1, view.canvas.clientHeight),
      background: '#060b13',
    });
    view.label.replaceChildren();
    const left = document.createElement('span');
    left.textContent = `${displayId} · ${view.slot.id}`;
    const right = document.createElement('span');
    right.innerHTML = `<strong>#${plan.imageIndex ?? '—'}</strong>${view.display.status === 'offline' ? ' <span class="offline">OFF</span>' : ''}`;
    view.label.append(left, right);
    view.monitor.title = `${view.display.name} · ${plan.viewport.width}×${plan.viewport.height} · ${plan.fit} · ${plan.rotation}°`;
  }
  updateTransport(firstPlan);
}

function renderPattern() {
  const pattern = state.pattern;
  ui.patternTable.replaceChildren();
  if (!pattern || pattern.rows.length === 0) {
    ui.patternCount.textContent = '—';
    return;
  }
  ui.patternCount.textContent = `${pattern.displayedSlots}/${pattern.periodSlots} slots`;
  const markDuplicates = !['mirror', 'canvas'].includes(state.snapshot.mode) && state.snapshot.playlist.items.length < state.snapshot.displays.length;
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const slotHead = document.createElement('th');
  slotHead.textContent = 'slot';
  headRow.append(slotHead);
  for (const display of state.snapshot.displays) {
    const th = document.createElement('th');
    th.textContent = display.id.replace(/^disp-/, '').replace(/^site-[a-z]-preview-/, 'p');
    th.title = display.name;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const row of pattern.rows) {
    const tr = document.createElement('tr');
    const slotCell = document.createElement('td');
    slotCell.textContent = String(row.slot);
    tr.append(slotCell);
    for (const cell of row.cells) {
      const td = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'chip';
      if (cell.placeholder) {
        chip.classList.add('empty');
        chip.textContent = '—';
      } else {
        chip.textContent = String((cell.imageIndex ?? 0) + 1);
        chip.title = cell.imageId;
        if (markDuplicates && row.duplicatesOnDisplays.includes(cell.imageId)) chip.classList.add('dup');
      }
      td.append(chip);
      tr.append(td);
    }
    tbody.append(tr);
  }
  ui.patternTable.append(thead, tbody);
}

function resetRange() {
  if (!state.snapshot) return;
  const dwell = state.snapshot.dwellMs ?? 10_000;
  const imageCount = Math.max(1, state.snapshot.playlist.items.length);
  const span = Math.max(12, imageCount * 2) * dwell;
  const live = serverNow();
  if (!Number.isFinite(state.previewNow) || state.previewNow < state.snapshot.epochMs || state.previewNow > state.snapshot.epochMs + span) {
    state.previewNow = state.playing ? live : state.snapshot.epochMs + Math.max(0, live - state.snapshot.epochMs);
  }
  ui.scrub.max = String(span);
  ui.scrub.value = String(Math.max(0, state.previewNow - state.snapshot.epochMs));
  drawBoard();
}

function updateTransport(firstPlan) {
  if (!state.snapshot) return;
  const dwell = state.snapshot.dwellMs ?? 10_000;
  const elapsed = state.previewNow - state.snapshot.epochMs;
  const span = Number(ui.scrub.max) || dwell * 12;
  if (elapsed > span) {
    const nextSpan = span + Math.max(6, state.snapshot.playlist.items.length) * dwell;
    ui.scrub.max = String(nextSpan);
  }
  ui.scrub.value = String(Math.max(0, Math.min(Number(ui.scrub.max), elapsed)));
  ui.timeLabel.textContent = formatTime(state.previewNow);
  if (firstPlan) {
    ui.slotLabel.textContent = `slot ${firstPlan.slot ?? '—'} · offset ${Math.round(firstPlan.offsetMs ?? 0)}ms`;
  }
  ui.playPause.textContent = state.playing ? '일시정지' : '재생';
}

function startPlaybackLoop() {
  if (state.renderTimer) clearInterval(state.renderTimer);
  state.renderTimer = setInterval(() => {
    if (!state.snapshot) return;
    if (state.playing) {
      state.previewNow = serverNow();
      const span = Number(ui.scrub.max) || 0;
      if (state.previewNow - state.snapshot.epochMs > span) {
        ui.scrub.max = String(state.previewNow - state.snapshot.epochMs + 30_000);
      }
    }
    drawBoard();
  }, 120);
}

function renderPlayerLinks() {
  ui.playerLinks.replaceChildren();
  const links = state.site?.demo?.playerUrls ?? [];
  for (const link of links.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = 'player-link';
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.textContent = `${link.displayId} — ${link.name}`;
    anchor.title = link.url;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '복사';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(new URL(link.url, location.origin).href);
        showToast('플레이어 링크를 복사했습니다.');
      } catch {
        showToast('클립보드에 복사하지 못했습니다. 링크를 직접 복사해 주세요.');
      }
    });
    row.append(anchor, copy);
    ui.playerLinks.append(row);
  }
}

function renderSiteMeta() {
  const site = state.site;
  const group = state.group;
  ui.siteName.textContent = site.name;
  ui.siteMeta.textContent = `${site.id} · ${site.timezone} · 키 ${site.siteKey ?? '—'} · v${site.publication?.version ?? '—'} · ${group?.name ?? '—'}`;
  renderPlayerLinks();
}

async function loadSite(siteId, { preserveTime = false } = {}) {
  const previousTime = state.previewNow;
  const site = await fetchJson(`/api/sites/${encodeURIComponent(siteId)}`);
  state.site = site;
  state.group = site.groups?.[0] ?? null;
  if (!state.group) throw new Error('Site has no display group');
  ui.siteSelect.value = site.id;
  ui.modeSelect.value = state.group.playbackMode;
  ui.imageCount.value = 'site';
  ui.displayCount.value = String(Math.max(1, site.displays.length));
  ui.layoutSelect.value = 'site';
  ui.fitSelect.value = state.group.settings?.fit ?? 'contain';
  state.playing = true;
  state.previewNow = preserveTime ? previousTime : serverNow();
  const url = new URL(location.href);
  url.searchParams.set('site', site.id);
  history.replaceState(null, '', url.href);
  renderSiteMeta();
  await preloadAllImages(site);
  buildScenario();
  drawBoard();
}

async function bootstrap() {
  setServerStatus(false, '서버 확인 중');
  try {
    const [sites, demo, time] = await Promise.all([
      fetchJson('/api/sites'),
      fetchJson('/api/demo'),
      fetchJson('/api/time'),
    ]);
    state.sites = sites;
    state.demo = demo;
    state.clockOffsetMs = Number(time.serverTime ?? time.now) - Date.now();
    ui.siteSelect.replaceChildren(...sites.map((site) => {
      const option = document.createElement('option');
      option.value = site.id;
      option.textContent = `${site.name} (${site.displayCount}면 · ${site.imageCount}장)${site.siteKey ? ` · ${site.siteKey}` : ''}`;
      return option;
    }));
    const requested = new URLSearchParams(location.search).get('site');
    const siteId = sites.some((site) => site.id === requested) ? requested : sites[0]?.id;
    if (!siteId) throw new Error('No demo sites');
    await loadSite(siteId);
    setServerStatus(true, '서버 연결됨');
    startPlaybackLoop();
    state.pollTimer = setInterval(async () => {
      try {
        const next = await fetchJson('/api/time');
        state.clockOffsetMs = Number(next.serverTime ?? next.now) - Date.now();
        setServerStatus(true, '서버 연결됨');
      } catch {
        setServerStatus(false, '서버 오프라인');
      }
    }, 30_000);
  } catch (error) {
    setServerStatus(false, '서버 오프라인');
    ui.warnings.textContent = `미리보기를 불러오지 못했습니다: ${error.message}`;
    showToast(`서버에 연결할 수 없습니다: ${error.message}`, 10_000);
  }
}

function rebuildAfterControlChange(message = '') {
  if (message) state.scenarioNote = message;
  buildScenario();
  drawBoard();
}

ui.siteSelect.addEventListener('change', async () => {
  try {
    await loadSite(ui.siteSelect.value);
  } catch (error) {
    showToast(`장소를 불러오지 못했습니다: ${error.message}`);
  }
});
ui.refresh.addEventListener('click', async () => {
  try {
    await loadSite(state.site.id, { preserveTime: true });
    setServerStatus(true, '서버 연결됨');
    showToast('서버 상태와 이미지를 다시 불러왔습니다.');
  } catch (error) {
    setServerStatus(false, '서버 오프라인');
    showToast(`새로 고침 실패: ${error.message}`);
  }
});
ui.modeSelect.addEventListener('change', () => rebuildAfterControlChange(`재생 방식: ${MODE_LABELS[ui.modeSelect.value]}`));
ui.imageCount.addEventListener('change', () => rebuildAfterControlChange(`이미지 수: ${ui.imageCount.value === 'site' ? '장소 기본' : `${ui.imageCount.value}장`}`));
ui.layoutSelect.addEventListener('change', () => rebuildAfterControlChange());
ui.fitSelect.addEventListener('change', () => rebuildAfterControlChange(`이미지 맞춤: ${ui.fitSelect.value}`));
ui.displayCount.addEventListener('change', () => rebuildAfterControlChange(`모니터 수: ${ui.displayCount.value}대`));
ui.displayMinus.addEventListener('click', () => {
  ui.displayCount.value = String(Math.max(1, Number(ui.displayCount.value) - 1));
  rebuildAfterControlChange(`모니터 제거 · ${ui.displayCount.value}대 · epoch 유지`);
});
ui.displayPlus.addEventListener('click', () => {
  ui.displayCount.value = String(Math.min(12, Number(ui.displayCount.value) + 1));
  rebuildAfterControlChange(`모니터 추가 · ${ui.displayCount.value}대 · epoch 유지`);
});
for (const button of document.querySelectorAll('.quick')) {
  button.addEventListener('click', () => {
    ui.displayCount.value = button.dataset.count;
    rebuildAfterControlChange(`모니터 수 시나리오: ${button.dataset.count}대`);
  });
}
ui.playPause.addEventListener('click', () => {
  state.playing = !state.playing;
  if (state.playing) state.previewNow = serverNow();
  drawBoard();
});
ui.goLive.addEventListener('click', () => {
  state.playing = true;
  state.previewNow = serverNow();
  drawBoard();
});
ui.scrub.addEventListener('input', () => {
  state.playing = false;
  if (!state.snapshot) return;
  state.previewNow = state.snapshot.epochMs + Number(ui.scrub.value);
  drawBoard();
});
window.addEventListener('resize', () => drawBoard());

bootstrap();
