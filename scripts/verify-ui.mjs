// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-signage-verify-'));
const port = Number(process.env.VERIFY_PORT || 3123);
const base = `http://127.0.0.1:${port}`;
const evidenceDir = path.join(root, 'docs', 'verification', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base,
  temporaryDataDir: '<system temp>',
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  playerOnline: null,
  playerOffline: null,
  serverStoppedAt: null,
};
let server = null;
let serverLog = '';
let browser = null;
let controlWatcher = null;

function startFakePlayerControl() {
  const controlDir = path.join(tempDir, 'control');
  const commandPath = path.join(controlDir, 'player-command.json');
  const statePath = path.join(controlDir, 'player-state.json');
  fs.mkdirSync(controlDir, { recursive: true });
  let running = false;
  let deviceId = null;
  let playerUrl = null;
  let startedAt = null;
  const writeState = () => {
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      desired: running ? 'running' : 'stopped',
      running,
      pid: running ? process.pid : null,
      startedAt: running ? startedAt : null,
      deviceId,
      playerUrl,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  };
  writeState();
  const timer = setInterval(() => {
    try {
      if (!fs.existsSync(commandPath)) return;
      const command = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
      fs.rmSync(commandPath, { force: true });
      if (command.action === 'launch') {
        running = true;
        deviceId = command.deviceId || null;
        playerUrl = command.playerUrl || null;
        startedAt = new Date().toISOString();
      } else if (command.action === 'stop') {
        running = false;
      }
      writeState();
    } catch {
      // The verification control watcher ignores partially written commands.
    }
  }, 150);
  return () => clearInterval(timer);
}

function sanitizeLog(text) {
  return String(text)
    .replaceAll(root, '<repo>')
    .replaceAll(tempDir, '<temp>')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, '<home>');
}

function step(name, detail = {}) {
  report.steps.push({ name, at: new Date().toISOString(), ...detail });
  console.log(`[verify] ${name}`, Object.keys(detail).length ? detail : '');
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempDir,
    DB_PATH: path.join(tempDir, 'verify.sqlite'),
    UPLOAD_DIR: path.join(tempDir, 'uploads'),
    ADMIN_PASSWORD: 'verify-password',
    SESSION_SECRET: 'verify-session-secret-for-local-evidence-only',
    SEED_SAMPLES: 'true',
  };
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('검증 서버가 시간 안에 시작하지 않았습니다.');
}

async function stopServer() {
  if (!server) return;
  report.serverStoppedAt = new Date().toISOString();
  const child = server;
  server = null;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function cacheKeyCount(page) {
  return page.evaluate(async () => {
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('gugak-signage-media', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise((resolve, reject) => {
        const request = db.transaction('media', 'readonly').objectStore('media').getAllKeys();
        request.onsuccess = () => { db.close(); resolve(request.result.length); };
        request.onerror = () => reject(request.error);
      });
    } catch { return -1; }
  });
}

try {
  controlWatcher = startFakePlayerControl();
  startServer();
  await waitForHealth();
  step('서버 시작', { url: base });

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
  const admin = await adminContext.newPage();
  admin.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) report.consoleErrors.push(message.text());
  });
  admin.on('pageerror', (error) => report.pageErrors.push(error.message));
  await admin.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await admin.screenshot({ path: path.join(evidenceDir, '01-admin-login.png') });
  step('관리 화면 로그인 페이지 확인');

  await admin.fill('#password', 'verify-password');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('.hero', { timeout: 10_000 });
  await admin.waitForSelector('.sample-banner', { timeout: 10_000 });
  const sampleBannerText = await admin.locator('.sample-banner h2').innerText();
  if (sampleBannerText !== '지금은 샘플 콘텐츠가 표시 중입니다. 내 이미지를 올리고 재생목록을 게시하세요.') {
    throw new Error(`샘플 콘텐츠 배너 문구가 올바르지 않습니다: ${sampleBannerText}`);
  }
  const sampleActions = await admin.locator('.sample-banner a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  if (!sampleActions.includes('#/contents') || !sampleActions.includes('#/playlists') || !sampleActions.includes('#/devices')) {
    throw new Error(`샘플 배너의 콘텐츠·재생목록·기기 버튼이 부족합니다: ${sampleActions.join(', ')}`);
  }
  const stepLinks = await admin.locator('.steps a.step').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  if (stepLinks.length !== 4 || stepLinks[0] !== '#/contents' || stepLinks[1] !== '#/devices' || stepLinks[2] !== '#/playlists' || stepLinks[3] !== '#/devices') {
    throw new Error(`4단계 안내 링크가 올바르지 않습니다: ${stepLinks.join(', ')}`);
  }
  if (await admin.locator('.broadcast-card .broadcast-item').count() < 1) {
    throw new Error('재생기가 꺼진 상태에서도 현재 송출 항목이 표시되지 않습니다.');
  }
  if (await admin.locator('.broadcast-item.is-current').count()) {
    throw new Error('재생기가 꺼진 상태에서 현재 항목이 강조되었습니다.');
  }
  await admin.waitForTimeout(400);
  await admin.screenshot({ path: path.join(evidenceDir, '02-admin-dashboard.png'), fullPage: true });
  step('로그인 후 대시보드의 샘플 배너와 클릭 가능한 4단계 안내 확인', {
    title: await admin.title(),
    sampleActions,
    stepLinks,
  });

  await admin.locator('.broadcast-card [data-action=launch-player]').first().click();
  await admin.waitForSelector('.broadcast-card [data-action=stop-player]', { timeout: 8_000 });
  await admin.locator('[data-action=stop-player]').first().click();
  await admin.waitForSelector('.broadcast-card [data-action=launch-player]', { timeout: 8_000 });
  await admin.locator('.broadcast-card [data-action=launch-player]').first().click();
  await admin.waitForSelector('[data-action=stop-player]', { timeout: 8_000 });
  await admin.screenshot({ path: path.join(evidenceDir, '26-admin-player-controls.png'), fullPage: true });
  step('대시보드 재생기 실행·중지와 실행 상태 표시 확인');

  await admin.click('a[data-nav=contents]');
  await admin.waitForSelector('.content-grid');
  await admin.setInputFiles('#content-file-input', [
    path.join(root, 'seed', 'poster-class.png'),
    path.join(root, 'seed', 'sample-video.mp4'),
  ]);
  await admin.waitForFunction(() => document.querySelectorAll('.content-card').length >= 7, null, { timeout: 40_000 });
  await admin.waitForTimeout(300);
  await admin.screenshot({ path: path.join(evidenceDir, '03-admin-contents-uploaded.png'), fullPage: true });
  step('관리 화면에서 이미지·동영상 업로드', { contentCards: await admin.locator('.content-card').count() });

  await admin.click('a[data-nav=playlists]');
  await admin.waitForSelector('.playlist-row');
  await admin.click('[data-action=new-playlist]');
  await admin.fill('#create-playlist-form input[name=name]', 'MVP 검증 재생목록');
  await admin.fill('#create-playlist-form textarea[name=description]', '브라우저 검증에서 만든 이미지·동영상·URL 순환 목록');
  await admin.click('button[form=create-playlist-form]');
  await admin.waitForSelector('#playlist-editor-form');
  await admin.waitForTimeout(400);

  const addItem = async (matchText) => {
    const options = await admin.locator('#add-content-select option').allTextContents();
    const label = options.find((option) => option.includes(matchText));
    if (!label) throw new Error(`콘텐츠 옵션을 찾지 못했습니다: ${matchText}`);
    await admin.locator('#add-content-select').selectOption({ label });
    const before = await admin.locator('[data-editor-item]').count();
    await admin.click('[data-action=add-playlist-item]');
    await admin.waitForFunction((count) => document.querySelectorAll('[data-editor-item]').length === count + 1, before);
  };
  await addItem('poster-class');
  await addItem('sample-video');
  await addItem('오늘의 안내');
  await admin.locator('[data-editor-item]').nth(0).locator('[data-item-duration]').fill('3');
  await admin.waitForTimeout(200);
  await admin.screenshot({ path: path.join(evidenceDir, '04-admin-playlist-editor.png'), fullPage: true });
  await admin.click('#playlist-editor-form button[type=submit]');
  await admin.waitForSelector('.toast:not([hidden])');
  step('관리 화면에서 재생목록 생성·항목 저장', { items: await admin.locator('[data-editor-item]').count() });

  await admin.click('a[data-nav=devices]');
  await admin.waitForSelector('.device-card');
  if (!(await admin.locator('.device-card [data-action=launch-player]').count()) &&
      !(await admin.locator('.device-card [data-action=stop-player]').count())) {
    throw new Error('기기 카드에서 재생기 실행·중지 제어를 찾지 못했습니다.');
  }
  await admin.click('[data-action=device-settings]');
  await admin.waitForSelector('#device-settings-form');
  const playlistLabel = await admin.locator('#device-default-playlist option').allTextContents();
  const verifyPlaylistLabel = playlistLabel.find((label) => label.includes('MVP 검증 재생목록'));
  if (!verifyPlaylistLabel) throw new Error('기기 설정에서 검증 재생목록을 찾지 못했습니다.');
  await admin.locator('#device-default-playlist').selectOption({ label: verifyPlaylistLabel });
  await admin.click('button[form=device-settings-form][data-after=publish]');
  await admin.waitForFunction(() => !document.querySelector('#modal')?.open, null, { timeout: 10_000 });
  await admin.waitForTimeout(600);
  await admin.screenshot({ path: path.join(evidenceDir, '05-admin-device-published.png'), fullPage: true });
  const deviceText = await admin.locator('.device-card').first().innerText();
  if (!deviceText.includes('v2')) throw new Error(`게시 버전이 화면에 반영되지 않았습니다: ${deviceText}`);
  const visibleCode = (await admin.locator('.device-card .device-code').first().innerText()).trim();
  if (visibleCode !== 'GUGAK1') throw new Error(`관리 화면의 샘플 코드가 예상과 다릅니다: ${visibleCode}`);
  step('관리 화면 기기 카드에서 등록 코드 GUGAK1 확인', { visibleCode });
  step('관리 화면에서 기기에 재생목록 배정·게시', { publishedVersion: 2 });

  const connectCode = await admin.evaluate(async () => {
    const response = await fetch('/api/devices');
    const data = await response.json();
    return data.devices[0].pairingCode;
  });
  if (connectCode !== 'GUGAK1') throw new Error(`기기 API의 샘플 코드가 예상과 다릅니다: ${connectCode}`);

  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ko-KR' });
  const player = await playerContext.newPage();
  player.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) report.consoleErrors.push(`player: ${message.text()}`);
  });
  player.on('pageerror', (error) => report.pageErrors.push(`player: ${error.message}`));
  await player.goto(`${base}/player/`, { waitUntil: 'networkidle' });
  await player.waitForSelector('#pair-form');
  await player.waitForSelector('#sample-hint:not([hidden])');
  const adminLink = await player.locator('.pair-admin-link a').getAttribute('href');
  if (adminLink !== '/admin/#/devices') throw new Error(`관리 화면 링크가 올바르지 않습니다: ${adminLink}`);
  const sampleText = await player.locator('#sample-hint').innerText();
  if (!sampleText.includes('GUGAK1')) throw new Error(`샘플 코드 힌트가 보이지 않습니다: ${sampleText}`);
  await player.screenshot({ path: path.join(evidenceDir, '11-player-pair-guide.png') });
  step('코드 없는 재생기 첫 화면에서 관리 링크·샘플 코드 확인', { adminLink, sampleCode: 'GUGAK1' });

  await player.fill('#pair-code', 'ABC123');
  await player.click('#pair-button');
  await player.waitForSelector('#pair-error:not([hidden])');
  const pairError = await player.locator('#pair-error').innerText();
  if (!pairError.includes('관리 화면') || !pairError.includes('GUGAK1')) {
    throw new Error(`잘못된 코드 안내가 부족합니다: ${pairError}`);
  }
  await player.screenshot({ path: path.join(evidenceDir, '12-player-pair-error.png') });
  step('잘못된 코드 404 안내 확인', { message: pairError });

  await player.click('#sample-connect');
  await player.waitForSelector('body[data-current-content-id]', { timeout: 20_000 });
  await player.waitForTimeout(1200);
  await player.screenshot({ path: path.join(evidenceDir, '06-player-online.png') });
  report.playerOnline = await player.evaluate(() => window.__signagePlayer.getState());
  step('샘플 코드 버튼으로 등록·게시 목록 재생', { ...report.playerOnline, sampleCode: connectCode });

  await player.waitForFunction(() => Boolean(document.querySelector('.slide video')), null, { timeout: 15_000 });
  await player.waitForTimeout(1200);
  await player.screenshot({ path: path.join(evidenceDir, '07-player-video.png') });
  step('재생기 동영상 재생 확인', await player.evaluate(() => window.__signagePlayer.getState()));

  await player.waitForSelector('.slide iframe', { timeout: 20_000 });
  await player.frameLocator('.slide iframe').locator('h1').waitFor({ timeout: 10_000 });
  const urlHeading = await player.frameLocator('.slide iframe').locator('h1').innerText();
  if (!urlHeading.includes('오늘의 안내')) throw new Error(`URL 콘텐츠가 표시되지 않았습니다: ${urlHeading}`);
  await player.screenshot({ path: path.join(evidenceDir, '10-player-url.png') });
  step('재생기 URL 콘텐츠 표시 확인', { heading: urlHeading });

  await admin.click('a[data-nav=dashboard]');
  await admin.waitForSelector('.broadcast-card', { timeout: 15_000 });
  // The player sends a heartbeat every 15 seconds, so refresh the admin view
  // until a heartbeat carrying playing:<contentId> has reached the dashboard.
  let currentHighlights = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await admin.click('#refresh-button');
    await admin.waitForTimeout(350);
    currentHighlights = await admin.locator('.broadcast-item.is-current').count();
    if (currentHighlights === 1) break;
    await admin.waitForTimeout(750);
  }
  if (currentHighlights !== 1) throw new Error('현재 재생 중인 항목이 대시보드에 하나로 강조되지 않았습니다.');
  const broadcastCard = admin.locator('.broadcast-card').first();
  const broadcastText = await broadcastCard.innerText();
  for (const expected of ['MVP 검증 재생목록', 'v2', 'poster-class', 'sample-video', '지금 화면', '재생기 미리보기', '마지막 오류']) {
    if (!broadcastText.includes(expected)) throw new Error(`현재 송출 카드에 '${expected}'가 없습니다: ${broadcastText}`);
  }
  const currentItem = await admin.locator('.broadcast-item.is-current').first().innerText();
  if (!currentItem.includes('번') || !currentItem.includes('초') || (!currentItem.includes('contain') && !currentItem.includes('cover'))) {
    throw new Error(`현재 항목에 순서·표시 시간·fit 정보가 부족합니다: ${currentItem}`);
  }
  const previewHref = await broadcastCard.locator('a', { hasText: '재생기 미리보기' }).getAttribute('href');
  if (!previewHref?.startsWith('/player/')) throw new Error(`재생기 미리보기 링크가 올바르지 않습니다: ${previewHref}`);
  if (await admin.locator('.sample-banner').count()) throw new Error('사용자 콘텐츠를 게시한 뒤에도 샘플 배너가 남아 있습니다.');
  await admin.screenshot({ path: path.join(evidenceDir, '25-admin-current-broadcast.png'), fullPage: true });
  step('대시보드 현재 송출 카드에서 실제 항목·현재 재생 강조·게시 버전 확인', { previewHref, currentItem });

  let cachedKeys = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    cachedKeys = await cacheKeyCount(player);
    if (cachedKeys >= 2) break;
    await player.waitForTimeout(250);
  }
  report.cacheKeysBeforeStop = cachedKeys;
  if (cachedKeys < 2) throw new Error('재생기 로컬 캐시가 준비되지 않았습니다.');
  step('재생기 IndexedDB 캐시 확인', { cachedKeys });

  const beforeStopState = await player.evaluate(() => window.__signagePlayer.getState());
  report.beforeStopState = beforeStopState;
  await stopServer();
  await player.waitForSelector('#offline-badge:not([hidden])', { timeout: 25_000 });
  await player.waitForSelector('.slide img, .slide video', { timeout: 25_000 });
  await player.waitForTimeout(1200);
  await player.screenshot({ path: path.join(evidenceDir, '08-player-offline.png') });
  report.playerOffline = await player.evaluate(() => window.__signagePlayer.getState());
  step('서버 종료 후 오프라인 배지와 재생 지속 확인', report.playerOffline);

  const offlineStartState = report.playerOffline;
  await player.waitForFunction((startContent) => window.__signagePlayer.getState().currentContentId !== startContent, offlineStartState.currentContentId, { timeout: 10_000 });
  report.offlineProgressState = await player.evaluate(() => window.__signagePlayer.getState());
  step('서버 종료 후 재생 위치 진행', report.offlineProgressState);
  await player.waitForSelector('.url-offline', { timeout: 20_000 });
  await player.waitForTimeout(500);
  const afterOfflineState = await player.evaluate(() => window.__signagePlayer.getState());
  report.afterOfflineState = afterOfflineState;
  await player.screenshot({ path: path.join(evidenceDir, '09-player-offline-next.png') });
  if (!afterOfflineState.offline) throw new Error('서버 종료 후 오프라인 상태가 유지되지 않았습니다.');
  if (afterOfflineState.currentContentId === offlineStartState.currentContentId) throw new Error('서버 종료 후 재생 위치가 진행되지 않았습니다.');
  step('서버 종료 후 다음 항목으로 순환', afterOfflineState);

  const serviceWorkerControlled = await player.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Boolean(registration?.active && navigator.serviceWorker.controller);
  });
  report.serviceWorkerControlled = serviceWorkerControlled;
  if (serviceWorkerControlled) {
    await player.goto(`${base}/player/?code=${connectCode}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await player.waitForSelector('body[data-current-content-id]', { timeout: 20_000 });
    await player.waitForSelector('#offline-badge:not([hidden])', { timeout: 20_000 });
    if (await player.locator('#pair-form').isVisible()) throw new Error('오프라인 재실행에서 불필요한 연결 화면이 표시되었습니다.');
    const reopenedState = await player.evaluate(() => window.__signagePlayer.getState());
    if (!reopenedState.offline || !reopenedState.currentContentId) {
      throw new Error(`오프라인 재실행 상태가 올바르지 않습니다: ${JSON.stringify(reopenedState)}`);
    }
    await player.waitForTimeout(1200);
    await player.screenshot({ path: path.join(evidenceDir, '21-player-offline-reopen.png') });
    step('서버 종료 후 같은 코드 URL로 재실행해 캐시 재생', reopenedState);
  } else {
    step('서비스 워커 미제어로 오프라인 재실행 검사 생략');
  }

  await playerContext.close();
  await adminContext.close();
  await browser.close();
  browser = null;
  report.finishedAt = new Date().toISOString();
  report.result = 'passed';
  console.log('[verify] 통과');
} catch (error) {
  report.result = 'failed';
  report.error = error.stack || error.message;
  console.error('[verify] 실패:', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (controlWatcher) controlWatcher();
  await stopServer();
  report.serverLog = sanitizeLog(serverLog);
  if (report.error) report.error = sanitizeLog(report.error);
  fs.writeFileSync(path.join(root, 'docs', 'verification', 'ui-run.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'docs', 'verification', 'ui-run.txt'), `${report.serverLog}\n\n${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
}
