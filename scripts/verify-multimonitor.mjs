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
        items: [{ contentId: image.id, durationSeconds: 3, fitMode: 'cover', transitionMs: 250, enabled: true }],
      }),
    });
    if (!updatedResponse.ok) throw new Error(await updatedResponse.text());
    return { id: created.playlist.id, name: created.playlist.name, contentId: image.id };
  });
  step('격리된 검증용 화면 전용 재생목록 생성', playlist);

  await admin.locator('.site-card').first().click();
  await admin.waitForSelector('.topology-config');
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

  const fourth = admin.locator('.screen-assignment').nth(3);
  await fourth.locator('[data-screen-fit]').selectOption('cover');
  await fourth.locator('[data-screen-playlist]').selectOption(playlist.id);
  await fourth.locator('[data-topology-action=save-screen]').click();
  await admin.waitForSelector('.preview-canvas');
  await admin.waitForFunction((playlistId) =>
    Array.from(document.querySelectorAll('.screen-assignment select[data-screen-playlist]'))
      .some((select) => select.value === playlistId), playlist.id);
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
      nextChanges: preview.plans.map((plan) => plan.nextChangeAt),
    };
  });
  step('관리 미리보기와 실제 엔진 RenderPlan 동일 응답 확인', report.adminPreview);

  await admin.locator('[data-topology-action=publish]').first().click();
  await admin.waitForFunction(() =>
    document.querySelector('.toast:not([hidden])')?.textContent?.includes('게시했습니다'), null, { timeout: 10_000 });
  const toastText = await admin.locator('.toast').innerText();
  step('4화면 배치 게시', { toast: toastText });

  const player = await context.newPage();
  player.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) report.consoleErrors.push(`player: ${message.text()}`);
  });
  player.on('pageerror', (error) => report.pageErrors.push(`player: ${error.message}`));
  await player.goto(`${base}/player/?code=GUGAK1`, { waitUntil: 'networkidle' });
  await player.waitForSelector('.wall-surface .wall-screen', { timeout: 30_000 });
  await player.waitForFunction(() => document.querySelectorAll('.wall-screen').length === 4, null, { timeout: 10_000 });
  await player.waitForTimeout(2_500);
  await player.screenshot({ path: path.join(evidenceDir, 'multimonitor-03-player-four-screens.png') });
  report.player = await player.evaluate(() => ({
    ...window.__signagePlayer.getState(),
    screenCount: document.querySelectorAll('.wall-screen').length,
    mediaCount: document.querySelectorAll('.wall-screen .wall-media').length,
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

  const firstDisplayId = report.player.wallDisplayIds[0];
  await player.goto(`${base}/player/?display=${encodeURIComponent(firstDisplayId)}`, { waitUntil: 'networkidle' });
  await player.waitForSelector('.wall-surface.is-single .wall-screen', { timeout: 30_000 });
  await player.waitForSelector('.wall-surface .wall-media', { timeout: 30_000 });
  await player.screenshot({ path: path.join(evidenceDir, 'multimonitor-04-player-single-display-window.png') });
  report.perMonitorWindow = await player.evaluate(() => ({
    ...window.__signagePlayer.getState(),
    screenCount: document.querySelectorAll('.wall-screen').length,
  }));
  step('모니터별 분리 창 모드 확인', report.perMonitorWindow);

  if (report.adminPreview.displays !== 4 || report.player.screenCount !== 4 || report.perMonitorWindow.screenCount !== 1) {
    throw new Error('브라우저 화면 수가 예상과 다릅니다.');
  }
  if (report.pageErrors.length) throw new Error(`브라우저 페이지 오류: ${report.pageErrors.join(' | ')}`);
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
