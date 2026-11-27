// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-multimonitor-verify-'));
const evidenceDir = path.join(root, 'docs', 'verification', 'evidence');
const port = Number(process.env.VERIFY_PORT || 3141);
const base = `http://127.0.0.1:${port}`;
fs.mkdirSync(evidenceDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base,
  temporaryDataDir: '<system temp>',
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  adminPreview: null,
  player: null,
  perMonitorWindow: null,
  offlineReload: null,
  testingOffline: false,
  physicalMonitors: 'NOT_RUN',
  finishedAt: null,
  result: 'running',
  serverLog: '',
};

let server;
let browser;

function sanitize(text) {
  return String(text)
    .replaceAll(root, '<repo>')
    .replaceAll(tempDir, '<temp>')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, '<home>');
}

function step(name, detail = {}) {
  report.steps.push({ name, at: new Date().toISOString(), ...detail });
  process.stdout.write(`[verify] ${name}\n`);
}

function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: tempDir,
      DB_PATH: path.join(tempDir, 'verify.sqlite'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      ADMIN_PASSWORD: 'multimonitor-verify-password',
      SESSION_SECRET: 'multimonitor-verify-session-secret',
      SEED_SAMPLES: 'true',
    },
  });
  server.stdout.on('data', (chunk) => { report.serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { report.serverLog += chunk.toString(); });
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('검증 서버가 시간 안에 시작하지 않았습니다.');
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  current.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

try {
  startServer();
  await waitForHealth();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
  const admin = await context.newPage();
  admin.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) report.consoleErrors.push(message.text());
  });
  admin.on('pageerror', (error) => report.pageErrors.push(error.message));

  await admin.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await admin.fill('#password', 'multimonitor-verify-password');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('.hero');
  await admin.click('a[data-nav=sites]');
  await admin.waitForSelector('.site-card');
  await admin.screenshot({ path: path.join(evidenceDir, 'multimonitor-01-admin-sites.png'), fullPage: true });
  step('장소 목록 화면 확인', { siteCards: await admin.locator('.site-card').count() });

  const playlist = await admin.evaluate(async () => {
    const contentsResponse = await fetch('/api/contents');
    const contents = (await contentsResponse.json()).contents;
    const image = contents.find((content) => content.kind === 'image' && content.height > content.width) || contents.find((content) => content.kind === 'image');
    const createdResponse = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '4번 화면 전용 이미지', description: '다중 모니터 브라우저 검증용' }),
    });
    const created = await createdResponse.json();
    const updatedResponse = await fetch(`/api/playlists/${created.playlist.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: created.playlist.name,
        description: created.playlist.description,
        items: [{ contentId: image.id, durationSeconds: 3, transitionMs: 250, enabled: true }],
      }),
    });
    if (!updatedResponse.ok) throw new Error(await updatedResponse.text());
    const url = contents.find((content) => content.kind === 'url');
    if (!url) throw new Error('검증용 URL 콘텐츠가 준비되지 않았습니다.');
    const urlPlaylistResponse = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '4번 화면 URL 단독', description: '다중 모니터 URL 브라우저 검증용' }),
    });
    const urlPlaylist = (await urlPlaylistResponse.json()).playlist;
    const urlPlaylistUpdate = await fetch(`/api/playlists/${urlPlaylist.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: urlPlaylist.name,
        description: urlPlaylist.description,
        items: [{ contentId: url.id, durationSeconds: 30, transitionMs: 300, enabled: true }],
      }),
    });
    if (!urlPlaylistUpdate.ok) throw new Error(await urlPlaylistUpdate.text());
    return {
      id: created.playlist.id,
      name: created.playlist.name,
      contentId: image.id,
      urlPlaylistId: urlPlaylist.id,
      urlContentId: url.id,
    };
  });
  step('격리된 검증용 이미지·URL 화면 재생목록 생성', playlist);

  await admin.locator('.site-card').first().click();
  await admin.waitForSelector('.topology-config');
  await admin.getByRole('heading', { name: '이 PC에 연결된 실제 모니터' }).waitFor();
  await admin.waitForFunction(() => {
    const status = document.querySelector('[data-native-monitors-status]')?.textContent || '';
    return status !== '감지 정보를 불러오는 중…';
  });
  step('현재 PC의 물리 모니터 감지 상태 표시', {
    detectedMonitors: await admin.locator('[data-native-monitors-list] .screen-assignment').count(),
    status: await admin.locator('[data-native-monitors-status]').textContent(),
  });
  await admin.fill('.topology-config input[name=displayCount]', '4');
  await admin.fill('.topology-config input[name=width]', '1280');
  await admin.fill('.topology-config input[name=height]', '720');
  await admin.selectOption('.topology-config select[name=layoutType]', 'grid');
  await admin.fill('.topology-config input[name=columns]', '2');
  await admin.fill('.topology-config input[name=rows]', '2');
  await admin.fill('.topology-config input[name=dwellSeconds]', '3');
  const deviceValue = await admin.locator('.topology-config select[name=deviceId] option').nth(1).getAttribute('value');
  if (!deviceValue) throw new Error('PC 기기가 준비되지 않았습니다.');
  await admin.selectOption('.topology-config select[name=deviceId]', deviceValue);
  const groupPlaylistLabel = (await admin.locator('.topology-config select[name=playlistId] option').allTextContents())
    .find((label) => label.includes('로비 기본 순환'));
  if (!groupPlaylistLabel) throw new Error('그룹 재생목록이 준비되지 않았습니다.');
  await admin.selectOption('.topology-config select[name=playlistId]', { label: groupPlaylistLabel });
  await admin.check('.topology-config input[name=resetEpoch]');
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForSelector('.preview-canvas');
  await admin.waitForFunction(() => document.querySelectorAll('.preview-screen').length === 4);
  step('관리 화면에서 4모니터·1280×720·2×2 배치 저장', {
    previewScreens: await admin.locator('.preview-screen').count(),
  });

  const secondDeviceId = await admin.evaluate(async () => {
    const response = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '브라우저 검증용 PC B', orientation: 'landscape', width: 1920, height: 1080 }),
    });
    const data = await response.json();
    if (!response.ok || !data.device?.id) throw new Error(data.error || '검증용 PC B를 만들지 못했습니다.');
    return data.device.id;
  });
  // Device creation adds a migration display; saving the current 4-screen
  // draft removes that temporary extra screen and refreshes the PC choices.
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForFunction(() => document.querySelectorAll('.screen-assignment').length === 4);
  const initialMapping = await admin.evaluate(async () => {
    const sites = await (await fetch('/api/sites')).json();
    const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
    return detail.groups[0].displays.map((display) => display.device_id);
  });
  if (initialMapping.length !== 4 || initialMapping.some((value) => value !== deviceValue)) {
    throw new Error(`초기 화면별 PC 배정이 예상과 다릅니다: ${JSON.stringify(initialMapping)}`);
  }

  const fourth = admin.locator('.screen-assignment').nth(3);
  const screenDeviceSelects = admin.locator('.screen-assignment [data-screen-device]');
  if (await screenDeviceSelects.count() !== 4) throw new Error('화면별 PC 선택 UI가 4개 표시되지 않았습니다.');
  await fourth.locator('[data-screen-device]').selectOption(secondDeviceId);
  const remoteMonitorPickerDisabled = await fourth.locator('[data-screen-native-monitor]').isDisabled();
  if (!remoteMonitorPickerDisabled) throw new Error('모니터 정보가 보고되지 않은 원격 Player에서 관리자 PC 모니터가 선택지로 노출되었습니다.');
  await fourth.locator('[data-topology-action=save-screen]').click();
  await admin.waitForFunction((secondId) =>
    document.querySelectorAll('.screen-assignment')[3]?.querySelector('[data-screen-device]')?.value === secondId,
  secondDeviceId);
  const explicitMapping = await admin.evaluate(async () => {
    const sites = await (await fetch('/api/sites')).json();
    const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
    return detail.groups[0].displays.map((display) => ({ deviceId: display.device_id, nativeMonitorId: display.nativeMonitorId }));
  });
  if (explicitMapping[3].deviceId !== secondDeviceId || explicitMapping[3].nativeMonitorId !== null || explicitMapping.slice(0, 3).some((value) => value.deviceId !== deviceValue)) {
    throw new Error(`화면별 명시적 PC 재배정이 반영되지 않았습니다: ${JSON.stringify(explicitMapping)}`);
  }
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForSelector('.preview-canvas');
  const savedMapping = await admin.evaluate(async () => {
    const sites = await (await fetch('/api/sites')).json();
    const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
    return detail.groups[0].displays.map((display) => ({ deviceId: display.device_id, nativeMonitorId: display.nativeMonitorId }));
  });
  if (JSON.stringify(savedMapping) !== JSON.stringify(explicitMapping)) {
    throw new Error(`그룹 저장이 화면별 PC 배정을 덮어썼습니다: ${JSON.stringify(savedMapping)}`);
  }
  report.deviceMapping = { initialMapping, explicitMapping, savedMapping, remoteMonitorPickerDisabled };
  step('화면별 PC 재배정 뒤 그룹 저장에서 기존 매핑 보존', report.deviceMapping);

  const refreshedFourth = admin.locator('.screen-assignment').nth(3);
  await refreshedFourth.locator('[data-screen-device]').selectOption(deviceValue);
  const localMonitor = await refreshedFourth.locator('[data-screen-native-monitor] option').evaluateAll((options) =>
    options.map((option) => option.value).find(Boolean) || '',
  );
  const physicalBindingStatus = localMonitor ? 'VERIFIED_IN_UI' : 'NOT_AVAILABLE_STABLE_MONITOR_ID';
  if (localMonitor) await refreshedFourth.locator('[data-screen-native-monitor]').selectOption(localMonitor);
  await refreshedFourth.locator('[data-screen-fit]').selectOption('cover');
  await refreshedFourth.locator('[data-screen-playlist]').selectOption(playlist.urlPlaylistId);
  const selectedPlaylistBeforeSave = await refreshedFourth.locator('[data-screen-playlist]').inputValue();
  if (selectedPlaylistBeforeSave !== playlist.urlPlaylistId) {
    throw new Error(`4번 화면 재생목록 선택이 유지되지 않았습니다. expected=${playlist.urlPlaylistId}, actual=${selectedPlaylistBeforeSave}`);
  }
  const screenDisplayId = await refreshedFourth.getAttribute('data-display-id');
  if (!screenDisplayId) throw new Error('4번 화면의 ID를 확인할 수 없습니다.');
  const screenSaveRequestPromise = admin.waitForRequest((request) =>
    request.url().includes(`/api/displays/${encodeURIComponent(screenDisplayId)}`) &&
    request.method() === 'PUT',
  );
  const screenSaveResponsePromise = admin.waitForResponse((response) =>
    response.url().includes(`/api/displays/${encodeURIComponent(screenDisplayId)}`) &&
    response.request().method() === 'PUT',
  );
  await refreshedFourth.locator('[data-topology-action=save-screen]').click();
  const screenSaveRequest = await screenSaveRequestPromise;
  const screenSaveResponse = await screenSaveResponsePromise;
  let screenSaveBody;
  try { screenSaveBody = await screenSaveResponse.json(); } catch { screenSaveBody = null; }
  const screenSaveRequestBody = screenSaveRequest.postDataJSON();
  report.screenSave = { status: screenSaveResponse.status(), requestBody: screenSaveRequestBody, body: screenSaveBody };
  if (!screenSaveResponse.ok()) {
    throw new Error(`화면 배정 저장 API가 실패했습니다: ${screenSaveResponse.status()} ${JSON.stringify(screenSaveBody)}`);
  }
  await admin.waitForSelector('.preview-canvas');
  try {
    await admin.waitForFunction((playlistId) =>
      document.querySelectorAll('.screen-assignment')[3]?.querySelector('[data-screen-playlist]')?.value === playlistId,
    playlist.urlPlaylistId);
  } catch (error) {
    report.screenSaveFailureState = await admin.evaluate(async () => {
      const sites = await (await fetch('/api/sites')).json();
      const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
      return {
        uiPlaylistId: document.querySelectorAll('.screen-assignment')[3]?.querySelector('[data-screen-playlist]')?.value || null,
        savedPlaylistId: detail.groups[0].displays[3]?.playlist_id || null,
        savedDeviceId: detail.groups[0].displays[3]?.device_id || null,
        toast: document.querySelector('.toast:not([hidden])')?.textContent || null,
      };
    });
    report.screenSaveFailureState.expectedPlaylistId = playlist.urlPlaylistId;
    report.screenSaveFailureState.selectedPlaylistBeforeSave = selectedPlaylistBeforeSave;
    report.screenSaveFailureState.requestBody = screenSaveRequestBody;
    throw new Error(`${error.message}; screen save state=${JSON.stringify(report.screenSaveFailureState)}`);
  }
  await admin.waitForSelector('.preview-screen iframe', { timeout: 10_000 });
  const adminUrlHeading = await admin.frameLocator('.preview-screen iframe').locator('h1').innerText({ timeout: 10_000 });
  if (!adminUrlHeading.includes('오늘의 안내')) throw new Error(`관리 미리보기 URL iframe이 표시되지 않았습니다: ${adminUrlHeading}`);
  await admin.screenshot({ path: path.join(evidenceDir, 'multimonitor-02-admin-plan-preview.png'), fullPage: true });
  report.adminPreview = await admin.evaluate(async () => {
    const sites = await (await fetch('/api/sites')).json();
    const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
    const preview = await (await fetch(`/api/groups/${detail.groups[0].id}/preview`)).json();
    return {
      displays: preview.wall.displays.length,
      plans: preview.plans.length,
      layout: preview.wall.layout.type,
      fits: preview.plans.map((plan) => plan.fit),
      rotations: preview.plans.map((plan) => plan.rotation),
      kinds: preview.plans.map((plan) => plan.kind),
      contentIds: preview.plans.map((plan) => plan.contentId),
      deviceMapping: preview.wall.displays.map((display) => display.deviceId),
      nextChanges: preview.plans.map((plan) => plan.nextChangeAt),
    };
  });
  if (report.adminPreview.kinds[3] !== 'url' || report.adminPreview.contentIds[3] !== playlist.urlContentId) {
    throw new Error(`관리 미리보기에 URL RenderPlan이 없습니다: ${JSON.stringify(report.adminPreview)}`);
  }
  step('관리 미리보기와 실제 엔진 RenderPlan 동일 응답 확인', report.adminPreview);

  await admin.locator('[data-topology-action=publish]').first().click();
  await admin.waitForFunction(() =>
    document.querySelector('.toast:not([hidden])')?.textContent?.includes('게시했습니다'), null, { timeout: 10_000 });
  const toastText = await admin.locator('.toast').innerText();
  step('4화면 배치 게시', { toast: toastText });

  const player = await context.newPage();
  player.on('console', (message) => {
    const expectedOffline = report.testingOffline && /Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR/.test(message.text());
    if (message.type() === 'error' && !message.text().includes('favicon') && !expectedOffline) {
      report.consoleErrors.push(`player: ${message.text()}`);
    }
  });
  player.on('pageerror', (error) => report.pageErrors.push(`player: ${error.message}`));
  await player.goto(`${base}/player/?code=GUGAK1`, { waitUntil: 'networkidle' });
  await player.waitForSelector('.wall-surface .wall-screen', { timeout: 30_000 });
  await player.waitForFunction(() => document.querySelectorAll('.wall-screen').length === 4, null, { timeout: 10_000 });
  await player.waitForSelector('.wall-screen iframe', { timeout: 20_000 });
  const wallUrlHeading = await player.frameLocator('.wall-screen iframe').locator('h1').innerText({ timeout: 10_000 });
  if (!wallUrlHeading.includes('오늘의 안내')) throw new Error(`wall URL iframe이 표시되지 않았습니다: ${wallUrlHeading}`);
  await player.waitForTimeout(2_500);
  await player.screenshot({ path: path.join(evidenceDir, 'multimonitor-03-player-four-screens.png') });
  report.player = await player.evaluate(() => ({
    ...window.__signagePlayer.getState(),
    screenCount: document.querySelectorAll('.wall-screen').length,
    mediaCount: document.querySelectorAll('.wall-screen .wall-media').length,
    urlFrameCount: document.querySelectorAll('.wall-screen iframe').length,
    renderReady: Array.from(document.querySelectorAll('.wall-screen-canvas')).map((node) => node.dataset.renderReady),
    screenHtml: Array.from(document.querySelectorAll('.wall-screen')).map((node) => node.innerHTML.slice(0, 300)),
  }));
  step('재생기에서 한 PC·4화면 캔버스 표시', report.player);

  const firstBefore = report.player.wallPlans;
  await player.waitForTimeout(3_300);
  const afterBoundary = await player.evaluate(() => window.__signagePlayer.getState());
  const changed = Object.keys(afterBoundary.wallPlans).some((id) => afterBoundary.wallPlans[id].imageId !== firstBefore[id]?.imageId);
  report.timing = { before: firstBefore, after: afterBoundary.wallPlans, changed, serverOffsetMs: afterBoundary.serverOffsetMs };
  step('서버 시각 기준 3초 전환 관찰', { changed, serverOffsetMs: afterBoundary.serverOffsetMs });
  if (!changed) throw new Error('3초 전환 경계 뒤에도 화면별 RenderPlan 콘텐츠가 바뀌지 않았습니다.');

  const firstDisplayId = report.player.wallDisplayIds[0];
  report.testingOffline = true;
  await context.setOffline(true);
  await player.reload({ waitUntil: 'domcontentloaded' });
  await player.waitForSelector('#offline-badge:not([hidden])', { timeout: 15_000 });
  await player.waitForSelector('.wall-surface .wall-screen', { timeout: 20_000 });
  await player.waitForFunction(() => {
    const state = window.__signagePlayer.getState();
    const plans = Object.values(state.wallPlans || {});
    const urlPlanCount = plans.filter((plan) => plan.kind === 'url').length;
    const imagePlanCount = plans.length - urlPlanCount;
    return plans.length === 4 && urlPlanCount > 0 &&
      document.querySelectorAll('.wall-screen .wall-media').length === imagePlanCount &&
      document.querySelectorAll('.wall-screen .wall-url-offline').length === urlPlanCount &&
      document.querySelectorAll('.wall-screen iframe').length === 0;
  }, null, { timeout: 20_000 });
  report.offlineReload = await player.evaluate(async () => {
    const shared = await import('/engine/index.js');
    const manifest = JSON.parse(localStorage.getItem('signage.player.manifest.v1'));
    const state = window.__signagePlayer.getState();
    const storedOffset = Number(localStorage.getItem('signage.player.manifestOffsetMs'));
    const expected = Object.fromEntries(manifest.wall.displays
      .filter((display) => display.deviceId === state.deviceId)
      .map((display) => {
        const actual = state.wallPlans[display.id];
        const plan = shared.buildRenderPlan(
          shared.wallScreenInput(manifest.wall, display.id),
          display.id,
          actual.atMs,
        );
        return [display.id, { imageId: plan.imageId, nextChangeAtMs: plan.nextChangeAtMs }];
      }));
    return {
      offsetNow: state.serverOffsetMs,
      storedOffset,
      offsetDriftMs: Math.abs(state.serverOffsetMs - storedOffset),
      cacheAgeMs: Date.now() - Number(localStorage.getItem('signage.player.manifestCachedAt')),
      screenCount: document.querySelectorAll('.wall-screen').length,
      urlFallbackCount: document.querySelectorAll('.wall-screen .wall-url-offline').length,
      urlFrameCount: document.querySelectorAll('.wall-screen iframe').length,
      urlPlanCount: Object.values(state.wallPlans).filter((plan) => plan.kind === 'url').length,
      plansMatchSharedInput: Object.entries(state.wallPlans).every(([displayId, plan]) =>
        plan.imageId === expected[displayId]?.imageId &&
        plan.nextChangeAtMs === expected[displayId]?.nextChangeAtMs),
      expected,
      actual: state.wallPlans,
    };
  });
  await player.screenshot({ path: path.join(evidenceDir, 'multimonitor-05-player-offline-reload.png') });
  step('오프라인 재로드에서 캐시 오프셋과 공유 RenderPlan 유지', report.offlineReload);
  if (report.offlineReload.offsetDriftMs > 50 || !report.offlineReload.plansMatchSharedInput) {
    throw new Error('오프라인 재로드 시각 보정이 캐시 시점과 다릅니다.');
  }
  if (report.offlineReload.urlFallbackCount !== report.offlineReload.urlPlanCount || report.offlineReload.urlFrameCount !== 0) {
    throw new Error(`오프라인 URL 대체 화면이 올바르지 않습니다: ${JSON.stringify(report.offlineReload)}`);
  }
  await context.setOffline(false);
  report.testingOffline = false;

  await player.goto(`${base}/player/?display=${encodeURIComponent(firstDisplayId)}`, { waitUntil: 'networkidle' });
  await player.waitForSelector('.wall-surface.is-single .wall-screen', { timeout: 30_000 });
  await player.waitForSelector('.wall-surface .wall-media', { timeout: 30_000 });
  await player.screenshot({ path: path.join(evidenceDir, 'multimonitor-04-player-single-display-window.png') });
  report.perMonitorWindow = await player.evaluate(() => ({
    ...window.__signagePlayer.getState(),
    screenCount: document.querySelectorAll('.wall-screen').length,
  }));
  report.physicalBindingStatus = physicalBindingStatus;
  step('모니터별 분리 창 모드 확인', report.perMonitorWindow);

  if (report.adminPreview.displays !== 4 || report.player.screenCount !== 4 || report.perMonitorWindow.screenCount !== 1) {
    throw new Error('브라우저 화면 수가 예상과 다릅니다.');
  }
  if (report.pageErrors.length) throw new Error(`브라우저 페이지 오류: ${report.pageErrors.join(' | ')}`);
  if (report.consoleErrors.length) throw new Error(`브라우저 콘솔 오류: ${report.consoleErrors.join(' | ')}`);
  report.result = 'passed';
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.result = 'failed';
  report.failure = sanitize(error.stack || error.message);
  report.finishedAt = new Date().toISOString();
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  report.serverLog = sanitize(report.serverLog);
  const jsonPath = path.join(root, 'docs', 'verification', 'multimonitor-run.json');
  const textPath = path.join(root, 'docs', 'verification', 'multimonitor-run.txt');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(textPath, `${JSON.stringify(report, null, 2)}\n\n${report.serverLog}`);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

