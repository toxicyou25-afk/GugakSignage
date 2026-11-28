// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const baseRef = '8eed9e1f30bdab61336252c68ffef36de392ee14';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-sw-update-'));
const profileDir = path.join(tempDir, 'persistent-profile');
const evidenceDir = path.join(root, 'docs', 'verification');
const baseFiles = new Map();
let server = null;
let context = null;
let mode = 'base';

const report = {
  startedAt: new Date().toISOString(),
  baseRef,
  profileMode: 'persistent',
  headless: true,
  mode,
  base: null,
  baseState: null,
  deployedHeadState: null,
  updatedState: null,
  result: 'running',
  finishedAt: null,
};

function sanitize(value) {
  return String(value)
    .replaceAll(root, '<repo>')
    .replaceAll(tempDir, '<temp>')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, '<home>');
}

function step(name, details = {}) {
  report.steps ??= [];
  report.steps.push({ name, at: new Date().toISOString(), ...details });
  process.stdout.write('[sw-update] ' + name + '\n');
}

function urlForPath(repoPath) {
  if (repoPath.startsWith('public/player/')) return '/player/' + repoPath.slice('public/player/'.length);
  if (repoPath.startsWith('poc/packages/engine/')) return '/engine/' + repoPath.slice('poc/packages/engine/'.length);
  return null;
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function loadBaseFiles() {
  const paths = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', baseRef, '--', 'public/player', 'poc/packages/engine'],
    { cwd: root, encoding: 'utf8' },
  ).trim().split(/\r?\n/).filter(Boolean);
  for (const repoPath of paths) {
    const urlPath = urlForPath(repoPath);
    if (!urlPath) continue;
    const body = execFileSync('git', ['show', baseRef + ':' + repoPath], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    baseFiles.set(urlPath, body);
  }
}

function serveHeadFile(urlPath) {
  if (!urlPath.startsWith('/player/') && !urlPath.startsWith('/engine/')) return null;
  const repoPath = urlPath.startsWith('/player/')
    ? path.join(root, 'public', 'player', urlPath.slice('/player/'.length))
    : path.join(root, 'poc', 'packages', 'engine', urlPath.slice('/engine/'.length));
  if (!repoPath.startsWith(root)) return null;
  try {
    return fs.readFileSync(repoPath);
  } catch {
    return null;
  }
}

function startServer() {
  server = http.createServer((request, response) => {
    const urlPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const normalized = urlPath === '/player/' ? '/player/index.html' : urlPath;
    const deployed = mode === 'base' ? baseFiles.get(normalized) : serveHeadFile(normalized);
    if (!deployed) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType(normalized),
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/player/',
    });
    response.end(deployed);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('검증 서버 주소를 확인하지 못했습니다.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function waitForShellVersion(page, version, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const state = await page.evaluate(() => window.__signagePlayer?.getState?.() ?? null);
      if (state?.shellVersion === version) return state;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('새 서비스 워커 셸 버전을 확인하지 못했습니다: ' + lastError);
}

try {
  loadBaseFiles();
  const port = await startServer();
  const base = 'http://127.0.0.1:' + port;
  report.base = base;
  report.baseFileCount = baseFiles.size;
  step('v4 기준 자산과 동일 origin 정적 서버 준비', { files: baseFiles.size, base });

  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: true,
    locale: 'ko-KR',
    serviceWorkers: 'allow',
    viewport: { width: 1280, height: 720 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(base + '/player/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__signagePlayer), null, { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });
  report.baseState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cachedPlayer = await caches.match('/player/player.js', { ignoreSearch: true });
    return {
      cacheKeys: keys.sort(),
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      active: registration.active?.scriptURL ?? null,
      playerShellVersion: window.__signagePlayer.getState().shellVersion ?? null,
      cachedPlayerIncludesV5: Boolean((await cachedPlayer?.text())?.includes("PLAYER_SHELL_VERSION = 'v5'")),
    };
  });
  if (!report.baseState.cacheKeys.includes('gugak-signage-shell-v4')) {
    throw new Error('기준 v4 셸 캐시가 생성되지 않았습니다: ' + JSON.stringify(report.baseState.cacheKeys));
  }
  if (report.baseState.playerShellVersion !== 'v4' || report.baseState.cachedPlayerIncludesV5) {
    throw new Error('기준 프로필이 예상보다 새 player.js를 사용했습니다.');
  }
  step('같은 persistent profile에 v4 셸 캐시 확인', report.baseState);

  mode = 'head';
  report.deployedHeadState = {
    directHeadFetchedV5: false,
    activeWorkerStillServesV4: false,
  };
  const directHead = await fetch(base + '/player/player.js?deploy=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache' },
  });
  const directHeadText = await directHead.text();
  report.deployedHeadState.directHeadFetchedV5 = directHead.ok && directHeadText.includes("PLAYER_SHELL_VERSION = 'v5'");
  const staleFetchText = await page.evaluate(async () => (await fetch('/player/player.js', { cache: 'no-store' })).text());
  report.deployedHeadState.activeWorkerStillServesV4 = staleFetchText.includes("PLAYER_SHELL_VERSION = 'v4'");
  if (!report.deployedHeadState.directHeadFetchedV5 || !report.deployedHeadState.activeWorkerStillServesV4) {
    throw new Error('HEAD 배포 전후의 v4 재현 상태가 올바르지 않습니다: ' + JSON.stringify(report.deployedHeadState));
  }
  step('같은 origin에 HEAD 배포 후 기존 v4 워커가 stale 자산 반환', report.deployedHeadState);

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  }).catch((error) => {
    if (!String(error.message).includes('Execution context was destroyed')) throw error;
  });
  const updatedPlayerState = await waitForShellVersion(page, 'v5');
  report.updatedState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cachedPlayer = await caches.match('/player/player.js', { ignoreSearch: true });
    const cachedWallInput = await caches.match('/engine/src/wall-input.js', { ignoreSearch: true });
    return {
      cacheKeys: keys.sort(),
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      active: registration.active?.scriptURL ?? null,
      playerShellVersion: window.__signagePlayer.getState().shellVersion,
      cachedPlayerIncludesV5: Boolean((await cachedPlayer?.text())?.includes("PLAYER_SHELL_VERSION = 'v5'")),
      cachedWallInputIncludesUrlKinds: Boolean((await cachedWallInput?.text())?.includes('kind: item.content.kind')),
    };
  });
  report.updatedState.playerShellVersion = updatedPlayerState.shellVersion;
  if (report.updatedState.playerShellVersion !== 'v5') {
    throw new Error('등록 갱신 뒤에도 이전 player.js가 실행 중입니다.');
  }
  if (!report.updatedState.cacheKeys.includes('gugak-signage-shell-v5') || report.updatedState.cacheKeys.includes('gugak-signage-shell-v4')) {
    throw new Error('셸 캐시 v5 전환이 올바르지 않습니다: ' + JSON.stringify(report.updatedState.cacheKeys));
  }
  if (!report.updatedState.cachedPlayerIncludesV5 || !report.updatedState.cachedWallInputIncludesUrlKinds) {
    throw new Error('새 player.js 또는 URL 지원 engine 자산이 v5 캐시에 없습니다.');
  }
  if (!report.updatedState.controller?.endsWith('/player/sw.js')) {
    throw new Error('새 서비스 워커가 page controller가 되지 않았습니다.');
  }
  step('registration.update 뒤 새 워커가 v5 자산으로 1회 갱신', report.updatedState);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.failure = sanitize(error.stack || error.message);
  console.error('[sw-update] 실패:', error);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(() => resolve()));
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'sw-update-run.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'sw-update-run.txt'), JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
}
