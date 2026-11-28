// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-multimonitor-verify-'));
// Use MULTIMONITOR_ARTIFACT_DIR=temporary to keep screenshots and run logs
// inside the disposable fixture directory instead of the tracked repo folder.
const artifactDir = process.env.MULTIMONITOR_ARTIFACT_DIR === 'temporary'
  ? path.join(tempDir, 'verification')
  : path.join(root, 'docs', 'verification');
const evidenceDir = path.join(artifactDir, 'evidence');
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
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+/giu, '<loopback-url>')
    .replace(/(?:127\.0\.0\.1|localhost):\d+/giu, '<loopback>')
    .replace(/\[::1\]:\d+/giu, '<loopback>')
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

  await admin.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let rejectInventoryRequest = true;
    window.fetch = (input, ...options) => {
      const url = typeof input === 'string' ? input : input.url;
      if (rejectInventoryRequest && url.includes('/monitor-inventory')) {
        rejectInventoryRequest = false;
        return Promise.reject(new TypeError('Simulated temporary inventory request failure'));
      }
      return originalFetch(input, ...options);
    };
  });
  const localFallbackMonitor = {
    stableId: 'VERIFY-LOCAL-FALLBACK',
    bindingId: 'MONITOR\\VERIFY-LOCAL-FALLBACK',
    deviceName: 'DISPLAY1',
    friendlyName: 'Local fallback monitor',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
    primary: true,
    attached: true,
  };
  await admin.evaluate((monitor) => {
    const originalFetch = window.fetch.bind(window);
    window.__gugakLocalMonitorSnapshot = monitor;
    window.fetch = (input, ...options) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/native-monitors') {
        return Promise.resolve(new Response(JSON.stringify({
          supported: true,
          detectedAt: new Date().toISOString(),
          monitors: window.__gugakLocalMonitorSnapshot ? [window.__gugakLocalMonitorSnapshot] : [],
          changes: [],
        }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return originalFetch(input, ...options);
    };
  }, localFallbackMonitor);
  const localFixtureDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  const localFixture = localFixtureDb.prepare('SELECT device_id FROM displays WHERE device_id IS NOT NULL ORDER BY start_index LIMIT 1').get();
  if (!localFixture?.device_id) throw new Error('현재 PC 모니터 검증용 Player가 준비되지 않았습니다.');
  localFixtureDb.prepare('UPDATE devices SET last_host_local = 1, last_seen = ? WHERE id = ?')
    .run(new Date().toISOString(), localFixture.device_id);
  localFixtureDb.close();
  await admin.locator('.site-card').first().click();
  try {
    await admin.waitForSelector('.topology-config', { timeout: 10_000 });
  } catch (error) {
    const editorFailure = await admin.locator('.empty').innerText().catch(() => '편집기가 표시되지 않았습니다.');
    throw new Error(`장소 편집기를 열지 못했습니다: ${editorFailure}; ${error.message}`);
  }
  await admin.getByRole('heading', { name: 'PC별 실제 모니터' }).waitFor();
  await admin.waitForSelector('[data-topology-action="retry-monitor-inventory"]', { timeout: 10_000 });
  const localDeviceBeforeRetry = await admin.locator('.screen-assignment').first().locator('[data-screen-device]').inputValue();
  const localOptionsBeforeRetry = await admin.locator('.screen-assignment').first().locator('[data-screen-native-monitor] option')
    .evaluateAll((options) => options.map((option) => option.value));
  if (!localOptionsBeforeRetry.includes(localFallbackMonitor.bindingId)) {
    throw new Error('모니터 인벤토리 오류 시 현재 PC의 직접 탐색 결과가 화면 선택기에서 제거되었습니다.');
  }
  step('인벤토리 요청 오류 중에도 현재 PC의 직접 모니터 배정 유지', { deviceId: localDeviceBeforeRetry });
  await admin.click('[data-topology-action="retry-monitor-inventory"]');
  await admin.waitForFunction(() => {
    const status = document.querySelector('[data-native-monitors-status]')?.textContent || '';
    return status.startsWith('생성 ') && document.querySelector('[data-native-monitors-list] .site-monitor-device');
  }, null, { timeout: 5_000 });
  step('모니터 인벤토리 요청 오류 뒤 재시도 복구');
  const localDeviceId = await admin.locator('.screen-assignment').first().locator('[data-screen-device]').inputValue();
  const localInventoryRow = admin.locator(`[data-site-monitor-device="${localDeviceId}"]`);
  const localMonitorOptions = await admin.locator('.screen-assignment').first().locator('[data-screen-native-monitor] option')
    .evaluateAll((options) => options.map((option) => option.value));
  const localInventoryText = await localInventoryRow.innerText().catch(() => '');
  if (!localMonitorOptions.includes(localFallbackMonitor.bindingId) ||
      !localInventoryText.includes(localFallbackMonitor.friendlyName)) {
    throw new Error(`이 PC의 직접 모니터 탐색 결과가 인벤토리와 화면 배정에서 누락되었습니다: ${JSON.stringify({ localMonitorOptions, row: localInventoryText })}`);
  }
  step('이 PC의 직접 모니터 탐색 결과를 화면 배정에 유지', { deviceId: localDeviceId, bindingId: localFallbackMonitor.bindingId });
  await admin.waitForFunction(() => {
    const status = document.querySelector('[data-native-monitors-status]')?.textContent || '';
    return status !== '보고 정보를 불러오는 중…';
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

  const secondDevice = await admin.evaluate(async () => {
    const response = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '브라우저 검증용 PC B <script>test</script>', orientation: 'landscape', width: 1920, height: 1080 }),
    });
    const data = await response.json();
    if (!response.ok || !data.device?.id) throw new Error(data.error || '검증용 PC B를 만들지 못했습니다.');
    return { id: data.device.id, pairingCode: data.device.pairingCode };
  });
  const secondDeviceId = secondDevice.id;
  const remoteMonitor = {
    stableId: 'VERIFY-REMOTE-STABLE', bindingId: 'MONITOR\\VERIFY-REMOTE-STABLE',
    deviceName: '\\\\.\\DISPLAY7', friendlyName: 'Reported <monitor> & "quoted"',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 },
    orientation: 'landscape', primary: true, attached: true,
  };
  const remoteMonitors = [remoteMonitor, {
    stableId: 'VERIFY-REMOTE-SECONDARY', bindingId: 'MONITOR\\VERIFY-REMOTE-SECONDARY',
    deviceName: '\\\\.\\DISPLAY8', friendlyName: 'Reported secondary monitor',
    bounds: { x: 1920, y: 0, width: 1280, height: 720 }, resolution: { width: 1280, height: 720 },
    orientation: 'landscape', primary: false, attached: true,
  }];
  const registrationResponse = await fetch(`${base}/api/player/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: secondDevice.pairingCode, hardwareId: 'VERIFY-REMOTE-HARDWARE-0001' }),
  });
  const registration = await registrationResponse.json();
  if (!registrationResponse.ok || !registration.token) {
    throw new Error(`검증용 원격 Player를 등록하지 못했습니다: ${JSON.stringify(registration)}`);
  }
  const monitorReportResponse = await fetch(`${base}/api/player/native-monitors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registration.token}` },
    body: JSON.stringify({ monitors: remoteMonitors }),
  });
  const monitorReport = await monitorReportResponse.json();
  if (!monitorReportResponse.ok) throw new Error(`원격 Player 모니터 보고를 저장하지 못했습니다: ${JSON.stringify(monitorReport)}`);
  // This verifier uses a disposable database under the OS temp directory.
  // Mark the fixture Player as remote; finally removes the whole fixture on
  // both success and failure, so no saved report or heartbeat is left behind.
  const seedDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  seedDb.prepare('UPDATE devices SET last_host_local = 0 WHERE id = ?').run(secondDeviceId);
  seedDb.close();
  const remoteInventory = await admin.evaluate(async (deviceId) => {
    const response = await fetch(`/api/native-monitors?deviceId=${encodeURIComponent(deviceId)}`);
    return { status: response.status, body: await response.json() };
  }, secondDeviceId);
  if (remoteInventory.status !== 200 || !remoteInventory.body.reported ||
      !remoteInventory.body.monitors?.some((monitor) => monitor.bindingId === remoteMonitor.bindingId)) {
    throw new Error(`관리자 API에서 원격 모니터 보고를 확인할 수 없습니다: ${JSON.stringify(remoteInventory)}`);
  }
  // Device creation adds a migration display; saving the current 4-screen
  // draft removes that temporary extra screen and refreshes the PC choices.
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForSelector('.preview-canvas');
  const fixtureDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  fixtureDb.prepare('UPDATE displays SET device_id = NULL WHERE device_id = ?').run(secondDeviceId);
  fixtureDb.prepare('UPDATE devices SET site_id = NULL WHERE id = ?').run(secondDeviceId);
  fixtureDb.close();
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForFunction((deviceId) => {
    const option = [...document.querySelectorAll('.topology-config select[name=deviceId] option')]
      .find((item) => item.value === deviceId);
    return option?.textContent?.includes('장소 미배정') && option.textContent.includes('온라인');
  }, secondDeviceId, { timeout: 10_000 });
  const onlineCandidate = await admin.evaluate(async (deviceId) => {
    const siteId = (await (await fetch('/api/sites')).json()).sites[0].id;
    const devices = (await (await fetch(`/api/sites/${encodeURIComponent(siteId)}/monitor-inventory`)).json()).devices;
    return devices.find((device) => device.deviceId === deviceId) || null;
  }, secondDeviceId);
  const secondDeviceOption = admin.locator(`.topology-config select[name=deviceId] option[value="${secondDeviceId}"]`);
  const candidateInventoryRow = admin.locator(`[data-site-monitor-device="${secondDeviceId}"]`);
  if (!onlineCandidate || onlineCandidate.siteAssigned !== false || onlineCandidate.status !== 'online' ||
      !onlineCandidate.monitorReport.reported || await secondDeviceOption.count() !== 1 ||
      !(await secondDeviceOption.innerText()).includes('장소 미배정') ||
      !(await secondDeviceOption.innerText()).includes('온라인') ||
      !(await candidateInventoryRow.locator('.site-monitor-state').getAttribute('class'))?.includes('badge-online')) {
    throw new Error(`온라인 장소 미배정 후보가 올바르게 표시되지 않았습니다: ${JSON.stringify({ onlineCandidate, option: await secondDeviceOption.innerText().catch(() => '') })}`);
  }
  const unassignedBindingId = onlineCandidate.monitorReport.monitors[0]?.bindingId;
  if (!unassignedBindingId) throw new Error('온라인 장소 미배정 후보에 보고된 모니터가 없습니다.');
  const candidateScreen = admin.locator('.screen-assignment').nth(0);
  await candidateScreen.locator('[data-screen-device]').selectOption(secondDeviceId);
  const candidateMonitorSelect = candidateScreen.locator('[data-screen-native-monitor]');
  if (await candidateMonitorSelect.isDisabled()) throw new Error('온라인 장소 미배정 후보 모니터 선택기가 비활성화되었습니다.');
  await candidateMonitorSelect.selectOption(unassignedBindingId);
  await candidateScreen.locator('[data-screen-device]').selectOption(deviceValue);
  step('장소 미배정 온라인 후보와 보고 모니터를 화면 배정에서 선택', { deviceId: secondDeviceId, bindingId: unassignedBindingId });
  const staleAt = new Date(Date.now() - 120_000).toISOString();
  const staleDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  staleDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(staleAt, secondDeviceId);
  staleDb.prepare('UPDATE player_monitor_reports SET reported_at = ? WHERE device_id = ?').run(staleAt, secondDeviceId);
  staleDb.close();
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  const inventoryRows = admin.locator('[data-site-monitor-device]');
  const localRow = admin.locator(`[data-site-monitor-device="${deviceValue}"]`);
  const offlineRow = admin.locator(`[data-site-monitor-device="${secondDeviceId}"]`);
  await admin.waitForFunction((deviceId) => {
    const status = document.querySelector('[data-native-monitors-status]')?.textContent || '';
    const offlineStatus = document.querySelector(`[data-site-monitor-device="${CSS.escape(deviceId)}"] .site-monitor-state`)?.textContent || '';
    return status !== '보고 정보를 불러오는 중…' && document.querySelectorAll('[data-site-monitor-device]').length === 2 &&
      offlineStatus.startsWith('오프라인');
  }, secondDeviceId, { timeout: 10_000 });
  const inventoryDeviceCount = await inventoryRows.count();
  const offlineText = inventoryDeviceCount === 2 ? await offlineRow.innerText() : '';
  const offlineMonitorCount = inventoryDeviceCount === 2 ? await offlineRow.locator('[data-site-monitor-monitor]').count() : 0;
  const localCoverage = inventoryDeviceCount === 2 ? await localRow.locator('.site-monitor-coverage').innerText() : '';
  const offlineBadgeClass = inventoryDeviceCount === 2 ? await offlineRow.locator('.site-monitor-state').getAttribute('class') : '';
  await candidateScreen.locator('[data-screen-device]').selectOption(secondDeviceId);
  const staleMonitorChoices = await candidateScreen.locator('[data-screen-native-monitor] option').evaluateAll((options) =>
    options.map((option) => ({ value: option.value, disabled: option.disabled })),
  );
  await candidateScreen.locator('[data-screen-device]').selectOption(deviceValue);
  const currentSiteInventory = await admin.evaluate(async () => {
    const siteId = (await (await fetch('/api/sites')).json()).sites[0].id;
    return (await (await fetch(`/api/sites/${encodeURIComponent(siteId)}/monitor-inventory`)).json()).devices;
  });
  const offlineDeviceInventory = currentSiteInventory.find((device) => device.deviceId === secondDeviceId);
  const localDeviceInventory = currentSiteInventory.find((device) => device.deviceId === deviceValue);
  const coverageText = (device) => `${device.assignedDisplayCount}/${device.logicalDisplayCount}개 화면 배정 · 미지정 ${device.unassignedDisplayIds.length}개`;
  const expectedOfflineCoverage = offlineDeviceInventory ? coverageText(offlineDeviceInventory) : '';
  const expectedLocalCoverage = localDeviceInventory ? coverageText(localDeviceInventory) : '';
  const renderedOfflineCoverage = inventoryDeviceCount === 2 ? await offlineRow.locator('.site-monitor-coverage').innerText() : '';
  if (inventoryDeviceCount !== 2 || !offlineText.includes('오프라인') ||
      !offlineText.includes('마지막 보고') || offlineMonitorCount !== 2 ||
      !offlineBadgeClass?.includes('badge-offline') ||
      staleMonitorChoices.some((option) => option.value && !option.disabled) ||
      offlineDeviceInventory?.status !== 'offline' ||
      !renderedOfflineCoverage.includes(expectedOfflineCoverage) || !localCoverage.includes(expectedLocalCoverage)) {
    throw new Error(`site monitor inventory shows each Player and last report: ${JSON.stringify({
      deviceRows: inventoryDeviceCount, offlineRow: offlineText, monitorRows: offlineMonitorCount,
      expectedOfflineCoverage, renderedOfflineCoverage, expectedLocalCoverage, localCoverage,
      offlineBadgeClass, staleMonitorChoices,
    })}`);
  }
  step('site monitor inventory shows each Player and last report', {
    deviceRows: inventoryDeviceCount, offlineMonitorRows: offlineMonitorCount,
    offlineCoverage: renderedOfflineCoverage, localCoverage,
  });
  if (!offlineText.includes('브라우저 검증용 PC B <script>test</script>') ||
      await offlineRow.locator('script').count() !== 0 ||
      !offlineText.includes('Reported <monitor> & "quoted"')) {
    throw new Error(`인벤토리 텍스트가 HTML로 해석되거나 이스케이프되지 않았습니다: ${offlineText}`);
  }
  await admin.setViewportSize({ width: 375, height: 900 });
  const narrowInventory = await offlineRow.evaluate((row) => ({
    width: row.getBoundingClientRect().width,
    scrollWidth: row.scrollWidth,
    clientWidth: row.clientWidth,
  }));
  if (narrowInventory.scrollWidth > narrowInventory.clientWidth + 1) {
    throw new Error(`좁은 화면에서 PC 인벤토리가 가로로 넘칩니다: ${JSON.stringify(narrowInventory)}`);
  }
  await admin.setViewportSize({ width: 1600, height: 1000 });
  const desktopInventory = await offlineRow.evaluate((row) => ({
    width: row.getBoundingClientRect().width,
    scrollWidth: row.scrollWidth,
    clientWidth: row.clientWidth,
  }));
  if (desktopInventory.scrollWidth > desktopInventory.clientWidth + 1) {
    throw new Error(`데스크톱 화면에서 PC 인벤토리가 가로로 넘칩니다: ${JSON.stringify(desktopInventory)}`);
  }

  const pendingStateDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  const pendingIdentity = pendingStateDb.prepare(`SELECT hardware_id, player_token, player_token_hash
    FROM devices WHERE id = ?`).get(secondDeviceId);
  pendingStateDb.close();
  const emptyReportResponse = await fetch(`${base}/api/player/native-monitors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registration.token}` },
    body: JSON.stringify({ monitors: [] }),
  });
  if (!emptyReportResponse.ok) throw new Error(`빈 모니터 보고를 저장하지 못했습니다: ${await emptyReportResponse.text()}`);
  const pendingAt = new Date().toISOString();
  const pendingDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  pendingDb.prepare('UPDATE devices SET hardware_id = NULL, player_token = NULL, player_token_hash = NULL, last_seen = NULL WHERE id = ?')
    .run(secondDeviceId);
  pendingDb.close();
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  const pendingRow = admin.locator(`[data-site-monitor-device="${secondDeviceId}"]`);
  await admin.waitForFunction((deviceId) => {
    const row = document.querySelector(`[data-site-monitor-device="${CSS.escape(deviceId)}"]`);
    return row?.querySelector('.site-monitor-state')?.textContent === '대기';
  }, secondDeviceId, { timeout: 10_000 });
  const pendingText = await pendingRow.innerText();
  if (!pendingText.includes('대기') || pendingText.includes('오프라인') ||
      !pendingText.includes('보고된 모니터가 없습니다.') ||
      !(await pendingRow.locator('.site-monitor-state').getAttribute('class'))?.includes('badge-pending')) {
    throw new Error(`대기 상태와 성공한 빈 모니터 보고가 구분되지 않습니다: ${pendingText}`);
  }
  step('대기 Player와 성공한 빈 모니터 보고 구분', { pendingAt, text: pendingText });
  const restorePendingDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  restorePendingDb.prepare('UPDATE devices SET hardware_id = ?, player_token = ?, player_token_hash = ?, last_seen = ? WHERE id = ?')
    .run(pendingIdentity.hardware_id, pendingIdentity.player_token, pendingIdentity.player_token_hash, new Date().toISOString(), secondDeviceId);
  restorePendingDb.close();
  const restoredMonitorResponse = await fetch(`${base}/api/player/native-monitors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registration.token}` },
    body: JSON.stringify({ monitors: remoteMonitors }),
  });
  if (!restoredMonitorResponse.ok) throw new Error(`검증용 Player 상태를 복원하지 못했습니다: ${await restoredMonitorResponse.text()}`);
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  await admin.waitForFunction((deviceId) =>
    document.querySelector(`[data-site-monitor-device="${CSS.escape(deviceId)}"] .site-monitor-state`)?.textContent === '온라인',
  secondDeviceId, { timeout: 10_000 });
  await admin.evaluate((monitor) => {
    const originalFetch = window.fetch.bind(window);
    window.__gugakLocalMonitorSnapshot = monitor;
    window.fetch = (input, ...options) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/native-monitors') {
        return Promise.resolve(new Response(JSON.stringify({
          supported: true,
          detectedAt: new Date().toISOString(),
          monitors: window.__gugakLocalMonitorSnapshot ? [window.__gugakLocalMonitorSnapshot] : [],
          changes: [],
        }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return originalFetch(input, ...options);
    };
  }, localFallbackMonitor);
  const localStatusBefore = await localInventoryRow.locator('.site-monitor-state').innerText();
  const refreshTestScreen = admin.locator('.screen-assignment').nth(0);
  await refreshTestScreen.locator('[data-screen-device]').selectOption(secondDeviceId);
  const staleRemoteBefore = await refreshTestScreen.locator('[data-screen-native-monitor] option')
    .evaluateAll((options) => options.map((option) => ({ value: option.value, disabled: option.disabled })));
  if (!localStatusBefore.includes('대기') ||
      !staleRemoteBefore.some((option) => option.value === remoteMonitor.bindingId && !option.disabled)) {
    throw new Error(`로컬 Player의 연결 상태 또는 온라인 원격 모니터 선택이 잘못되었습니다: ${JSON.stringify({ localStatusBefore, staleRemoteBefore })}`);
  }
  await refreshTestScreen.locator('[data-screen-device]').selectOption(deviceValue);
  const refreshedLocalMonitor = {
    ...localFallbackMonitor,
    stableId: 'VERIFY-LOCAL-REFRESHED',
    bindingId: 'MONITOR\\VERIFY-LOCAL-REFRESHED',
    friendlyName: 'Local monitor after refresh',
  };
  await admin.evaluate((monitor) => { window.__gugakLocalMonitorSnapshot = monitor; }, refreshedLocalMonitor);
  const refreshedRemoteMonitor = {
    ...remoteMonitors[0],
    stableId: 'VERIFY-REMOTE-REFRESHED',
    bindingId: 'MONITOR\\VERIFY-REMOTE-REFRESHED',
    friendlyName: 'Reported after editor opened',
  };
  const updateMonitorReport = await fetch(base + '/api/player/native-monitors', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + registration.token },
    body: JSON.stringify({ monitors: [refreshedRemoteMonitor, remoteMonitors[1]] }),
  });
  if (!updateMonitorReport.ok) throw new Error('모니터 새 보고를 저장하지 못했습니다: ' + await updateMonitorReport.text());
  await admin.waitForFunction(({ localDeviceId, localBindingId, remoteDeviceId, remoteBindingId }) => {
    const options = [...document.querySelectorAll('.screen-assignment [data-screen-device] option')];
    const local = options.find((item) => item.value === localDeviceId);
    const remote = options.find((item) => item.value === remoteDeviceId);
    try {
      return JSON.parse(local?.dataset.monitors || '[]').some((monitor) => monitor.bindingId === localBindingId) &&
        JSON.parse(remote?.dataset.monitors || '[]').some((monitor) => monitor.bindingId === remoteBindingId);
    } catch { return false; }
  }, {
    localDeviceId,
    localBindingId: refreshedLocalMonitor.bindingId,
    remoteDeviceId: secondDeviceId,
    remoteBindingId: refreshedRemoteMonitor.bindingId,
  }, { timeout: 25_000 });
  const refreshedLocalBindings = await admin.locator('.screen-assignment').nth(0).locator('[data-screen-device] option')
    .evaluateAll((options) => {
      const local = options.find((option) => option.selected);
      return JSON.parse(local?.dataset.monitors || '[]').map((monitor) => monitor.bindingId);
    });
  if (!refreshedLocalBindings.includes(refreshedLocalMonitor.bindingId) ||
      refreshedLocalBindings.includes(localFallbackMonitor.bindingId)) {
    throw new Error('열린 편집기의 로컬 모니터 목록이 주기 갱신되지 않았습니다: ' + JSON.stringify(refreshedLocalBindings));
  }
  await admin.locator('.screen-assignment').nth(0).locator('[data-screen-device]').selectOption(secondDeviceId);
  const refreshedBindings = await admin.locator('.screen-assignment').nth(0).locator('[data-screen-native-monitor] option')
    .evaluateAll((options) => options.map((option) => option.value));
  if (!refreshedBindings.includes(refreshedRemoteMonitor.bindingId) ||
      refreshedBindings.includes(remoteMonitors[0].bindingId) ||
      !refreshedBindings.includes(remoteMonitors[1].bindingId)) {
    throw new Error('Player의 새 모니터 보고가 열린 화면 배정 선택기에 반영되지 않았습니다: ' + JSON.stringify(refreshedBindings));
  }
  await admin.locator('.screen-assignment').nth(0).locator('[data-screen-device]').selectOption(deviceValue);
  const staleRemoteAt = new Date(Date.now() - 120_000).toISOString();
  const staleRemoteDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  staleRemoteDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(staleRemoteAt, secondDeviceId);
  staleRemoteDb.prepare('UPDATE player_monitor_reports SET snapshot_json = ?, reported_at = ? WHERE device_id = ?')
    .run(JSON.stringify(remoteMonitors), staleRemoteAt, secondDeviceId);
  staleRemoteDb.close();
  await admin.waitForFunction(({ localDeviceId, localBindingId, remoteDeviceId }) => {
    const localRow = document.querySelector(`[data-site-monitor-device="${CSS.escape(localDeviceId)}"]`);
    const remoteRow = document.querySelector(`[data-site-monitor-device="${CSS.escape(remoteDeviceId)}"]`);
    const options = [...document.querySelectorAll('.screen-assignment [data-screen-device] option')];
    const localOption = options.find((option) => option.value === localDeviceId);
    const remoteOption = options.find((option) => option.value === remoteDeviceId);
    try {
      const localBindings = JSON.parse(localOption?.dataset.monitors || '[]').map((monitor) => monitor.bindingId);
      const remoteBindings = JSON.parse(remoteOption?.dataset.monitors || '[]');
      return localRow?.querySelector('.site-monitor-state')?.textContent === '대기' &&
        remoteRow?.querySelector('.site-monitor-state')?.textContent?.startsWith('오프라인') &&
        localBindings.includes(localBindingId) && remoteBindings.length === 0 &&
        !localRow.querySelector('[data-site-monitor-monitor]')?.classList.contains('is-stale');
    } catch { return false; }
  }, { localDeviceId, localBindingId: refreshedLocalMonitor.bindingId, remoteDeviceId: secondDeviceId },
  { timeout: 25_000 });
  step('주기 갱신에서 로컬 탐색은 유지하고 오프라인 Player 선택지는 비활성화');
  const restoreFreshReport = await fetch(base + '/api/player/native-monitors', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + registration.token },
    body: JSON.stringify({ monitors: remoteMonitors }),
  });
  if (!restoreFreshReport.ok) throw new Error('원래 검증 모니터 보고를 복원하지 못했습니다: ' + await restoreFreshReport.text());
  step('열린 편집기에서 로컬 및 원격 Player의 최신 모니터 보고가 배정 선택기에 반영됨', {
    localBindingId: refreshedLocalMonitor.bindingId,
    remoteBindingId: refreshedRemoteMonitor.bindingId,
  });
  const onlineDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  const onlineAt = new Date().toISOString();
  onlineDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(onlineAt, secondDeviceId);
  onlineDb.prepare('UPDATE player_monitor_reports SET snapshot_json = ?, reported_at = ? WHERE device_id = ?')
    .run(JSON.stringify(remoteMonitors), onlineAt, secondDeviceId);
  onlineDb.close();
  await admin.evaluate((monitor) => { window.__gugakLocalMonitorSnapshot = monitor; }, localFallbackMonitor);
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  await admin.click('.topology-config button[type=submit]');
  await admin.waitForFunction(({ deviceId, bindingId }) => {
    const option = [...document.querySelectorAll('.screen-assignment [data-screen-device] option')].find((item) => item.value === deviceId);
    if (!option) return false;
    try { return JSON.parse(option.dataset.monitors || '[]').some((monitor) => monitor.bindingId === bindingId); } catch { return false; }
  }, { deviceId: secondDeviceId, bindingId: remoteMonitor.bindingId });
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
  const remoteMonitorSelect = fourth.locator('[data-screen-native-monitor]');
  const remoteMonitorPickerDisabled = await remoteMonitorSelect.isDisabled();
  if (remoteMonitorPickerDisabled) throw new Error('안정 식별자가 보고된 원격 Player의 모니터 선택기가 비활성화되었습니다.');
  const remoteMonitorOptionCount = await remoteMonitorSelect.locator('option').evaluateAll((options, bindingId) =>
    options.filter((option) => option.value === bindingId).length,
  remoteMonitor.bindingId);
  if (remoteMonitorOptionCount === 0) throw new Error('보고된 원격 모니터가 선택지에 없습니다.');
  await remoteMonitorSelect.selectOption(remoteMonitor.bindingId);
  await fourth.locator('[data-topology-action=save-screen]').click();
  await admin.waitForFunction((secondId) =>
    document.querySelectorAll('.screen-assignment')[3]?.querySelector('[data-screen-device]')?.value === secondId,
  secondDeviceId);
  const explicitMapping = await admin.evaluate(async () => {
    const sites = await (await fetch('/api/sites')).json();
    const detail = await (await fetch(`/api/sites/${sites.sites[0].id}`)).json();
    return detail.groups[0].displays.map((display) => ({ deviceId: display.device_id, nativeMonitorId: display.nativeMonitorId }));
  });
  if (explicitMapping[3].deviceId !== secondDeviceId || explicitMapping[3].nativeMonitorId !== remoteMonitor.bindingId || explicitMapping.slice(0, 3).some((value) => value.deviceId !== deviceValue)) {
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
  report.deviceMapping = { initialMapping, explicitMapping, savedMapping, remoteMonitorPickerDisabled, remoteMonitorBindingId: remoteMonitor.bindingId };
  step('화면별 PC 재배정 뒤 그룹 저장에서 기존 매핑 보존', report.deviceMapping);

  const undetectedDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  const undetectedAt = new Date(Date.now() - 120_000).toISOString();
  undetectedDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(undetectedAt, secondDeviceId);
  undetectedDb.prepare('UPDATE player_monitor_reports SET snapshot_json = ?, reported_at = ? WHERE device_id = ?')
    .run(JSON.stringify(remoteMonitors.slice(1)), undetectedAt, secondDeviceId);
  undetectedDb.close();
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  await admin.waitForFunction(({ displayIndex, bindingId }) => {
    const select = document.querySelectorAll('.screen-assignment')[displayIndex]?.querySelector('[data-screen-native-monitor]');
    const option = [...(select?.options || [])].find((item) => item.value === bindingId);
    return option?.disabled === true && option.textContent?.includes('오프라인 PC의 마지막 보고');
  }, { displayIndex: 3, bindingId: remoteMonitor.bindingId }, { timeout: 10_000 });
  const savedBindingSelect = admin.locator('.screen-assignment').nth(3).locator('[data-screen-native-monitor]');
  const savedBindingState = await savedBindingSelect.evaluate((select, bindingId) => {
    const options = [...select.options].filter((option) => option.value === bindingId);
    return { value: select.value, options: options.map((option) => ({ text: option.textContent, disabled: option.disabled })) };
  }, remoteMonitor.bindingId);
  if (savedBindingState.options.length !== 1 || !savedBindingState.options[0].disabled ||
      savedBindingState.value !== remoteMonitor.bindingId) {
    const currentInventory = await admin.evaluate(async () => {
      const siteId = (await (await fetch('/api/sites')).json()).sites[0].id;
      return (await (await fetch(`/api/sites/${encodeURIComponent(siteId)}/monitor-inventory`)).json()).devices;
    });
    throw new Error(`저장됐지만 현재 감지되지 않는 오프라인 모니터가 선택 불가 상태로 보존되지 않았습니다: ${JSON.stringify({
      savedBindingState, currentInventory: currentInventory.map(({ deviceId, online, monitorReport }) => ({
        deviceId, online, reportedAt: monitorReport.reportedAt, monitors: monitorReport.monitors.map((monitor) => monitor.bindingId),
      })),
    })}`);
  }
  step('저장됐지만 감지되지 않은 오프라인 모니터 배정은 비활성으로 표시', { bindingId: remoteMonitor.bindingId });
  const restoreReportDb = new DatabaseSync(path.join(tempDir, 'verify.sqlite'));
  const restoredReportAt = new Date().toISOString();
  restoreReportDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(restoredReportAt, secondDeviceId);
  restoreReportDb.prepare('UPDATE player_monitor_reports SET snapshot_json = ?, reported_at = ? WHERE device_id = ?')
    .run(JSON.stringify(remoteMonitors), restoredReportAt, secondDeviceId);
  restoreReportDb.close();
  await admin.reload();
  await admin.waitForSelector('.topology-config');
  await admin.waitForFunction(({ deviceId, bindingId }) => {
    const row = document.querySelectorAll('.screen-assignment')[3];
    const option = [...(row?.querySelector('[data-screen-native-monitor]')?.options || [])]
      .find((item) => item.value === bindingId);
    return row?.querySelector('[data-screen-device]')?.value === deviceId && option && !option.disabled &&
      document.querySelector(`[data-site-monitor-device="${CSS.escape(deviceId)}"] .site-monitor-state`)?.textContent === '온라인';
  }, { deviceId: secondDeviceId, bindingId: remoteMonitor.bindingId }, { timeout: 10_000 });

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
  const adminUrlHeading = await admin.frameLocator(`.preview-screen[data-display-id="${screenDisplayId}"] iframe`).locator('h1').innerText({ timeout: 10_000 });
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
  const wallUrlHeading = await player.frameLocator('.wall-screen iframe').nth(0).locator('h1').innerText({ timeout: 10_000 });
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
    const snapshot = JSON.parse(localStorage.getItem('signage.player.manifestSnapshot.v2'));
    const manifest = snapshot.manifest;
    const state = window.__signagePlayer.getState();
    const storedOffset = Number(snapshot.serverOffsetMs);
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
      cacheAgeMs: Date.now() - Number(snapshot.cachedAt),
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

  const clearRemoteMonitor = admin.locator('.screen-assignment').nth(3);
  await clearRemoteMonitor.locator('[data-screen-device]').selectOption(secondDeviceId);
  if (await clearRemoteMonitor.locator('[data-screen-native-monitor]').isDisabled()) {
    throw new Error('보고된 안정 모니터 ID가 있는 원격 Player에서 모니터 선택이 비활성화되었습니다.');
  }
  await clearRemoteMonitor.locator('[data-screen-native-monitor]').selectOption(remoteMonitor.bindingId);
  const remoteMonitorDisplayId = await clearRemoteMonitor.getAttribute('data-display-id');
  if (!remoteMonitorDisplayId) throw new Error('원격 화면의 ID를 확인할 수 없습니다.');
  const remoteMonitorRequestPromise = admin.waitForRequest((request) =>
    request.url().includes(`/api/displays/${encodeURIComponent(remoteMonitorDisplayId)}`) &&
    request.method() === 'PUT',
  );
  await clearRemoteMonitor.locator('[data-topology-action=save-screen]').click();
  const remoteMonitorBody = (await remoteMonitorRequestPromise).postDataJSON();
  if (!Object.hasOwn(remoteMonitorBody, 'nativeMonitorId') || remoteMonitorBody.nativeMonitorId !== remoteMonitor.bindingId) {
    throw new Error(`보고된 원격 모니터 선택을 저장할 때 식별자를 보내지 않았습니다: ${JSON.stringify(remoteMonitorBody)}`);
  }
  await admin.waitForFunction((deviceId) => {
    const row = document.querySelectorAll('.screen-assignment')[3];
    return row?.getAttribute('data-device-id') === deviceId && row?.getAttribute('data-local-host') === 'false' &&
      row.querySelector('[data-screen-device]')?.value === deviceId;
  }, secondDeviceId);
  step('재생기가 보고한 원격 모니터 ID를 관리자 배정에 저장', { requestBody: remoteMonitorBody });
  await clearRemoteMonitor.locator('[data-screen-native-monitor]').selectOption('');
  const clearMonitorDisplayId = await clearRemoteMonitor.getAttribute('data-display-id');
  if (!clearMonitorDisplayId) throw new Error('원격 화면의 ID를 확인할 수 없습니다.');
  const clearMonitorRequestPromise = admin.waitForRequest((request) =>
    request.url().includes(`/api/displays/${encodeURIComponent(clearMonitorDisplayId)}`) &&
    request.method() === 'PUT',
  );
  await clearRemoteMonitor.locator('[data-topology-action=save-screen]').click();
  const clearMonitorBody = (await clearMonitorRequestPromise).postDataJSON();
  if (!Object.hasOwn(clearMonitorBody, 'nativeMonitorId') || clearMonitorBody.nativeMonitorId !== null) {
    throw new Error(`같은 PC에서 모니터 배정을 지울 때 nativeMonitorId:null을 보내지 않았습니다: ${JSON.stringify(clearMonitorBody)}`);
  }
  step('같은 PC에서 원격 모니터 배정 해제 요청 확인', { requestBody: clearMonitorBody });

  await player.evaluate(() => {
    for (const key of [
      'signage.player.token', 'signage.player.pendingToken', 'signage.player.pendingCode',
      'signage.player.lastCode', 'signage.player.deviceId', 'signage.player.manifest.v1',
      'signage.player.manifestSnapshot.v2', 'signage.player.manifestOffsetMs', 'signage.player.manifestCachedAt',
    ]) localStorage.removeItem(key);
  });
  await player.close();
  const concurrentPages = [await context.newPage(), await context.newPage()];
  const registrationTokens = [];
  let registrationsInFlight = 0;
  let maxRegistrationsInFlight = 0;
  const registrationRoute = async (route) => {
    const body = route.request().postDataJSON();
    registrationTokens.push(body.playerToken || null);
    registrationsInFlight += 1;
    maxRegistrationsInFlight = Math.max(maxRegistrationsInFlight, registrationsInFlight);
    try {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ response });
    } finally {
      registrationsInFlight -= 1;
    }
  };
  await context.route('**/api/player/register', registrationRoute);
  try {
    await Promise.all(concurrentPages.map((page) => page.goto(`${base}/player/?code=GUGAK1&reconnect=1`, { waitUntil: 'domcontentloaded' })));
    await Promise.all(concurrentPages.map((page) => page.waitForFunction(() => {
      const state = window.__signagePlayer?.getState?.();
      return state?.deviceId === 'dev-sample-lobby' && state.manifestVersion !== null && !state.offline;
    }, null, { timeout: 30_000 })));
    const sharedTokens = await Promise.all(concurrentPages.map((page) => page.evaluate(() => localStorage.getItem('signage.player.token'))));
    const playerStates = await Promise.all(concurrentPages.map((page) => page.evaluate(() => window.__signagePlayer.getState())));
    if (registrationTokens.length !== 2 || new Set(registrationTokens).size !== 1 || maxRegistrationsInFlight !== 1 ||
        !registrationTokens[0] || sharedTokens[0] !== registrationTokens[0] || sharedTokens[1] !== registrationTokens[0]) {
      throw new Error(`동시 Player 창 등록이 하나의 인증 토큰으로 직렬화되지 않았습니다: ${JSON.stringify({ registrationTokens, sharedTokens, maxRegistrationsInFlight })}`);
    }
    step('동일 PC의 Player 창 동시 등록이 인증 토큰을 공유', { registrations: registrationTokens.length, maxRegistrationsInFlight, playerStates });
  } finally {
    await context.unroute('**/api/player/register', registrationRoute).catch(() => {});
    await Promise.all(concurrentPages.map((page) => page.close().catch(() => {})));
  }

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
  report.base = sanitize(report.base);
  report.serverLog = sanitize(report.serverLog);
  const jsonPath = path.join(artifactDir, 'multimonitor-run.json');
  const textPath = path.join(artifactDir, 'multimonitor-run.txt');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(textPath, `${JSON.stringify(report, null, 2)}\n\n${report.serverLog}`);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

