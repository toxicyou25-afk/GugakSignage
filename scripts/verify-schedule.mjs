// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-schedule-'));
const port = Number(process.env.VERIFY_SCHEDULE_PORT || 3125);
const base = `http://127.0.0.1:${port}`;
const evidenceDir = path.join(root, 'docs', 'verification', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const report = { startedAt: new Date().toISOString(), base, steps: [], pageErrors: [] };
let server = null;
let browser = null;
let serverLog = '';

function sanitizeLog(text) {
  return String(text)
    .replaceAll(root, '<repo>')
    .replaceAll(tempDir, '<temp>')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, '<home>');
}

function step(name, detail = {}) {
  report.steps.push({ name, at: new Date().toISOString(), ...detail });
  console.log(`[schedule] ${name}`, Object.keys(detail).length ? detail : '');
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempDir,
    DB_PATH: path.join(tempDir, 'schedule.sqlite'),
    UPLOAD_DIR: path.join(tempDir, 'uploads'),
    ADMIN_PASSWORD: 'schedule-password',
    SESSION_SECRET: 'schedule-session-secret-for-local-evidence',
    SEED_SAMPLES: 'true',
  };
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('시간표 검증 서버가 시간 안에 시작하지 않았습니다.');
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

try {
  startServer();
  await waitForHealth();
  step('서버 시작');

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const admin = await adminContext.newPage();
  admin.on('pageerror', (error) => report.pageErrors.push(`admin: ${error.message}`));
  await admin.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await admin.fill('#password', 'schedule-password');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('.hero');

  const created = await admin.evaluate(async () => {
    const playlists = await (await fetch('/api/playlists')).json();
    const playlist = playlists.playlists.find((entry) => entry.name === '로비 기본 순환');
    if (!playlist) throw new Error('샘플 재생목록을 찾지 못했습니다.');
    const deviceResponse = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gugak-Request': '1' },
      body: JSON.stringify({ name: '시간표 검증 화면', location: '검증실' }),
    });
    const device = await deviceResponse.json();
    if (!deviceResponse.ok) throw new Error(device.error || '기기 생성 실패');
    const assignmentResponse = await fetch(`/api/devices/${device.device.id}/assignment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Gugak-Request': '1' },
      body: JSON.stringify({
        playlistId: null,
        schedules: [
          {
            playlistId: playlist.id,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: '09:00',
            endTime: '10:00',
            enabled: true,
          },
          {
            playlistId: playlist.id,
            days: [0, 1, 2, 3, 4, 5, 6],
            startTime: '11:00',
            endTime: '12:00',
            enabled: true,
          },
        ],
      }),
    });
    const assignment = await assignmentResponse.json();
    if (!assignmentResponse.ok) throw new Error(assignment.error || '시간표 저장 실패');
    const publishResponse = await fetch(`/api/devices/${device.device.id}/publish`, {
      method: 'POST', headers: { 'X-Gugak-Request': '1' },
    });
    const publish = await publishResponse.json();
    if (!publishResponse.ok) throw new Error(publish.error || '게시 실패');
    return { code: device.device.pairingCode, playlistId: playlist.id, version: publish.version };
  });
  if (!created.code || created.version !== 1) throw new Error(`시간표 기기 준비 실패: ${JSON.stringify(created)}`);
  step('기본 목록 없이 시간표만 있는 기기 게시', created);

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const player = await context.newPage();
  player.on('pageerror', (error) => report.pageErrors.push(`player: ${error.message}`));
  await player.clock.install({ time: new Date('2026-11-24T08:00:00+09:00') });
  await player.goto(`${base}/player/?code=${created.code}`, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('#waiting-view:not([hidden])', { timeout: 15_000 });
  await player.screenshot({ path: path.join(evidenceDir, '22-schedule-waiting.png') });
  step('예약 시간 전 재생 대기 확인', { clock: '08:00', schedule: '09:00-10:00' });

  await player.clock.fastForward(61 * 60 * 1000);
  await player.waitForSelector('body[data-current-content-id]', { timeout: 15_000 });
  await player.waitForSelector('.slide img, .slide video', { timeout: 10_000 });
  const state = await player.evaluate(() => window.__signagePlayer.getState());
  if (state.queueLength < 1 || state.currentContentId !== 'ct-sample-poster-autumn') {
    throw new Error(`예약 시간 시작 후 재생되지 않았습니다: ${JSON.stringify(state)}`);
  }
  await player.clock.resume();
  await player.waitForTimeout(1200);
  await player.screenshot({ path: path.join(evidenceDir, '23-schedule-started.png') });
  step('예약 시간 시작 후 첫 콘텐츠 재생', state);

  await stopServer();
  await player.waitForSelector('#offline-badge:not([hidden])', { timeout: 20_000 });
  await player.clock.fastForward(60 * 60 * 1000);
  await player.waitForSelector('#waiting-view:not([hidden])', { timeout: 15_000 });
  step('서버 단절 상태에서 예약 시간 종료 반영', { clock: '10:01' });

  await player.clock.fastForward(60 * 60 * 1000);
  await player.waitForSelector('body[data-current-content-id]', { timeout: 15_000 });
  const offlineResumedState = await player.evaluate(() => window.__signagePlayer.getState());
  if (!offlineResumedState.offline || !offlineResumedState.currentContentId) {
    throw new Error(`서버 단절 상태에서 다음 예약 시간이 시작되지 않았습니다: ${JSON.stringify(offlineResumedState)}`);
  }
  step('서버 단절 상태에서 다음 예약 시간 자동 시작', offlineResumedState);

  report.result = 'passed';
  report.finishedAt = new Date().toISOString();
  await adminContext.close();
  await context.close();
  await browser.close();
  browser = null;
  console.log('[schedule] 통과');
} catch (error) {
  report.result = 'failed';
  report.error = error.stack || error.message;
  console.error('[schedule] 실패:', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  report.serverLog = sanitizeLog(serverLog);
  if (report.error) report.error = sanitizeLog(report.error);
  const verificationDir = path.join(root, 'docs', 'verification');
  fs.mkdirSync(verificationDir, { recursive: true });
  fs.writeFileSync(path.join(verificationDir, 'schedule-run.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(verificationDir, 'schedule-run.txt'), `${report.serverLog}\n\n${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
}
