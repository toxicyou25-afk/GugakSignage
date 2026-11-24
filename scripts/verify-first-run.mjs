// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-first-run-'));
const port = Number(process.env.VERIFY_FIRST_RUN_PORT || 3124);
const base = `http://127.0.0.1:${port}`;
const evidenceDir = path.join(root, 'docs', 'verification', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base,
  sampleCode: 'GUGAK1',
  steps: [],
  pageErrors: [],
  consoleErrors: [],
};
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
  console.log(`[first-run] ${name}`, Object.keys(detail).length ? detail : '');
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempDir,
    DB_PATH: path.join(tempDir, 'first-run.sqlite'),
    UPLOAD_DIR: path.join(tempDir, 'uploads'),
    ADMIN_PASSWORD: 'gugak1234',
    SESSION_SECRET: 'first-run-session-secret-for-local-evidence',
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
  throw new Error('첫 실행 검증 서버가 시간 안에 시작하지 않았습니다.');
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
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
  const admin = await adminContext.newPage();
  admin.on('pageerror', (error) => report.pageErrors.push(`admin: ${error.message}`));
  admin.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) report.consoleErrors.push(`admin: ${message.text()}`);
  });
  await admin.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await admin.waitForSelector('#login-demo-hint:not([hidden])');
  const loginHint = await admin.locator('#login-demo-hint').innerText();
  if (!loginHint.includes('gugak1234') || !loginHint.includes('운영 전')) {
    throw new Error(`개발 모드 비밀번호 힌트가 올바르지 않습니다: ${loginHint}`);
  }
  await admin.screenshot({ path: path.join(evidenceDir, '14-first-run-admin-login.png') });
  step('관리자 로그인 화면에서 개발 모드 비밀번호 힌트 확인', { loginHint });

  await admin.fill('#password', 'gugak1234');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('.hero', { timeout: 10_000 });
  await admin.click('a[data-nav=devices]');
  await admin.waitForSelector('.device-card');
  const code = (await admin.locator('.device-card .device-code').first().innerText()).trim();
  if (code !== 'GUGAK1') throw new Error(`관리 화면 기기 코드가 GUGAK1이 아닙니다: ${code}`);
  const cardText = await admin.locator('.device-card').first().innerText();
  if (!cardText.includes('로비 안내 화면')) throw new Error('샘플 기기 카드를 찾지 못했습니다.');
  await admin.screenshot({ path: path.join(evidenceDir, '15-first-run-admin-device.png'), fullPage: true });
  step('관리자 로그인 후 기기 카드에서 코드 확인', { code });

  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ko-KR' });
  const firstPlayer = await firstContext.newPage();
  firstPlayer.on('pageerror', (error) => report.pageErrors.push(`player1: ${error.message}`));
  await firstPlayer.goto(`${base}/player/`, { waitUntil: 'networkidle' });
  await firstPlayer.waitForSelector('#sample-hint:not([hidden])');
  await firstPlayer.screenshot({ path: path.join(evidenceDir, '16-first-run-player-pair.png') });
  await firstPlayer.click('#sample-connect');
  await firstPlayer.waitForSelector('body[data-current-content-id]', { timeout: 20_000 });
  await firstPlayer.waitForSelector('.slide img, .slide video', { timeout: 15_000 });
  await firstPlayer.waitForTimeout(800);
  const firstState = await firstPlayer.evaluate(() => window.__signagePlayer.getState());
  if (firstState.offline || !firstState.currentContentId || firstState.queueLength < 1) {
    throw new Error(`첫 실행 재생 상태가 올바르지 않습니다: ${JSON.stringify(firstState)}`);
  }
  await firstPlayer.screenshot({ path: path.join(evidenceDir, '17-first-run-player-playing.png') });
  step('코드 없이 샘플 버튼으로 연결하고 이미지 재생', firstState);

  await firstPlayer.setViewportSize({ width: 720, height: 1280 });
  await firstPlayer.waitForTimeout(600);
  const portraitState = await firstPlayer.evaluate(() => {
    const media = document.querySelector('.slide img, .slide video');
    if (!media) return null;
    const rect = media.getBoundingClientRect();
    return {
      viewport: `${innerWidth}x${innerHeight}`,
      fit: getComputedStyle(media).objectFit,
      rendered: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    };
  });
  if (!portraitState || portraitState.fit !== 'contain') {
    throw new Error(`세로 화면 비율 유지 확인 실패: ${JSON.stringify(portraitState)}`);
  }
  await firstPlayer.screenshot({ path: path.join(evidenceDir, '20-first-run-portrait.png') });
  step('세로 화면에서 비율 유지 재생 확인', portraitState);

  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ko-KR' });
  const secondPlayer = await secondContext.newPage();
  secondPlayer.on('pageerror', (error) => report.pageErrors.push(`player2: ${error.message}`));
  await secondPlayer.goto(`${base}/player/?code=GUGAK1`, { waitUntil: 'networkidle' });
  await secondPlayer.waitForSelector('#pair-recover:not([hidden])', { timeout: 15_000 });
  const conflictMessage = await secondPlayer.locator('#pair-error').innerText();
  if (!conflictMessage.includes('기존 연결')) throw new Error(`연결 충돌 안내가 부족합니다: ${conflictMessage}`);
  await secondPlayer.screenshot({ path: path.join(evidenceDir, '18-first-run-recover.png') });
  step('관리자 로그인 없이 기존 연결 복구 버튼 확인', { message: conflictMessage });

  await secondPlayer.click('#pair-recover');
  await secondPlayer.waitForSelector('body[data-current-content-id]', { timeout: 20_000 });
  await secondPlayer.waitForSelector('.slide img, .slide video', { timeout: 15_000 });
  const recoveredState = await secondPlayer.evaluate(() => window.__signagePlayer.getState());
  if (recoveredState.offline || !recoveredState.currentContentId) {
    throw new Error(`기존 연결 복구 후 재생 상태가 올바르지 않습니다: ${JSON.stringify(recoveredState)}`);
  }
  await secondPlayer.waitForTimeout(800);
  await secondPlayer.screenshot({ path: path.join(evidenceDir, '19-first-run-recovered.png') });
  step('기존 연결 끊고 다시 연결 후 재생', recoveredState);

  report.result = 'passed';
  report.finishedAt = new Date().toISOString();
  await firstContext.close();
  await secondContext.close();
  await adminContext.close();
  await browser.close();
  browser = null;
  console.log('[first-run] 통과');
} catch (error) {
  report.result = 'failed';
  report.error = error.stack || error.message;
  console.error('[first-run] 실패:', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  report.serverLog = sanitizeLog(serverLog);
  if (report.error) report.error = sanitizeLog(report.error);
  const verificationDir = path.join(root, 'docs', 'verification');
  fs.mkdirSync(verificationDir, { recursive: true });
  fs.writeFileSync(path.join(verificationDir, 'first-run.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(verificationDir, 'first-run.txt'), `${report.serverLog}\n\n${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
}
