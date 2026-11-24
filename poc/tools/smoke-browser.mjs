// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../apps/server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(here, '../artifacts');
const screenshotDir = path.join(artifactDir, 'screenshots');
const SAMPLE_MS = 65_000;
const SAMPLE_INTERVAL_MS = 500;
const LATE_JOIN_AFTER_MS = 20_000;
const OFFLINE_MS = 12_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright');
  const npxRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (npxRoot && (await exists(npxRoot))) {
    const entries = await fs.readdir(npxRoot, { withFileTypes: true });
    const packages = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(npxRoot, entry.name, 'node_modules', 'playwright', 'index.mjs');
      if (await exists(file)) {
        const stat = await fs.stat(file);
        packages.push({ file, mtime: stat.mtimeMs });
      }
    }
    packages.sort((a, b) => b.mtime - a.mtime);
    candidates.push(...packages.map((entry) => entry.file));
  }
  const globalRoot = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright', 'index.mjs') : null;
  if (globalRoot) candidates.push(globalRoot);
  for (const candidate of candidates) {
    try {
      const specifier = candidate === 'playwright' ? candidate : pathToFileURL(candidate).href;
      const module = await import(specifier);
      return { module, source: candidate };
    } catch {
      // Try the next installation.
    }
  }
  throw new Error('Playwright module not found. Set PLAYWRIGHT_MODULE or run npm install --no-save playwright.');
}

async function findChromium() {
  if (process.env.PLAYWRIGHT_CHROME && (await exists(process.env.PLAYWRIGHT_CHROME))) return process.env.PLAYWRIGHT_CHROME;
  const roots = [];
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  const candidates = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) continue;
      for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const file = path.join(root, entry.name, relative);
        if (await exists(file)) candidates.push(file);
      }
    }
  }
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (await exists(edge)) candidates.push(edge);
  if (candidates.length === 0) return null;
  return candidates[0];
}

function shortId(value) {
  return String(value).replace(/^disp-/, '').replace(/[^a-zA-Z0-9-]/g, '-');
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugak-smoke-'));
  const statePath = path.join(tempDir, 'state.json');
  const report = {
    startedAt: new Date(startedAt).toISOString(),
    sampleWindowMs: SAMPLE_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    browser: null,
    playwright: null,
    pages: [],
    drift: null,
    sequence: null,
    lateJoin: null,
    offline: null,
    serverRestart: null,
    consoleErrors: [],
    pageErrors: [],
    screenshots: [],
  };
  let server = null;
  let browser = null;
  try {
    const playwright = await findPlaywright();
    const executablePath = await findChromium();
    report.playwright = playwright.source;
    server = await startServer({ port: 0, statePath, reset: true, quiet: true });
    console.log(`[smoke] server ${server.url}`);
    browser = await playwright.module.chromium.launch({
      headless: true,
      executablePath: executablePath ?? undefined,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--no-first-run',
      ],
    });
    report.browser = browser.version();
    console.log(`[smoke] browser ${browser.version()} ${executablePath ?? '(bundled)'}`);

    const allConsoleErrors = [];
    const allPageErrors = [];
    const contexts = [];
    const pages = new Map();

    async function openDisplay(displayId, viewport, label) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => allPageErrors.push({ label, message: error.message }));
      page.on('console', (message) => {
        if (message.type() === 'error') allConsoleErrors.push({ label, text: message.text() });
      });
      const url = `${server.url}/player/?site=site-a&display=${encodeURIComponent(displayId)}&debug=1`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => window.__signage?.ready === true, { timeout: 30_000 });
      await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return;
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            setTimeout(resolve, 5000);
          });
        }
      });
      await sleep(500);
      const debug = await page.evaluate(() => window.__signage.debugState());
      pages.set(displayId, { context, page, viewport, label });
      report.pages.push({
        displayId,
        viewport,
        ready: debug.ready,
        online: debug.online,
        swControlled: debug.swControlled,
        mode: debug.mode,
        fit: debug.fit,
        rotation: debug.rotation,
        firstSlot: debug.slot,
        firstImageIndex: debug.imageIndex,
      });
      console.log(`[smoke] ${displayId} ready slot=${debug.slot} image=${debug.imageIndex} sw=${debug.swControlled}`);
      return pages.get(displayId);
    }

    await openDisplay('disp-a1', { width: 960, height: 540 }, 'a1');
    await openDisplay('disp-a2', { width: 960, height: 540 }, 'a2');
    await openDisplay('disp-a3', { width: 540, height: 960 }, 'a3');

    const sampleStart = Date.now();
    let lateJoin = null;
    const samples = [];
    while (Date.now() - sampleStart < SAMPLE_MS) {
      const elapsed = Date.now() - sampleStart;
      if (!lateJoin && elapsed >= LATE_JOIN_AFTER_MS) {
        const joined = await openDisplay('disp-a4', { width: 960, height: 540 }, 'a4-late');
        const debug = await joined.page.evaluate(() => window.__signage.debugState());
        const expected = ((3 + debug.slot) % 3 + 3) % 3;
        lateJoin = {
          displayId: 'disp-a4',
          openedAtMs: Date.now() - sampleStart,
          slot: debug.slot,
          imageIndex: debug.imageIndex,
          expectedImageIndex: expected,
          match: debug.imageIndex === expected,
          lagMs: debug.lastRender?.lagMs ?? null,
        };
        report.lateJoin = lateJoin;
        console.log(`[smoke] late join a4 slot=${debug.slot} image=${debug.imageIndex} expected=${expected}`);
      }
      const active = [...pages.values()];
      const rows = await Promise.all(
        active.map(async (entry) => {
          try {
            const debug = await entry.page.evaluate(() => window.__signage.debugState());
            return {
              displayId: debug.displayId,
              slot: debug.slot,
              imageIndex: debug.imageIndex,
              online: debug.online,
              now: debug.now,
            };
          } catch (error) {
            return { displayId: entry.label, error: error.message };
          }
        }),
      );
      samples.push({ at: Date.now(), elapsedMs: elapsed, rows });
      if (Math.floor(elapsed / 10_000) !== Math.floor((elapsed - SAMPLE_INTERVAL_MS) / 10_000)) {
        console.log(`[smoke] sampled ${(elapsed / 1000).toFixed(0)}s / ${SAMPLE_MS / 1000}s`);
      }
      await sleep(SAMPLE_INTERVAL_MS);
    }
    const sampleEnd = Date.now();
    console.log(`[smoke] sampling complete (${((sampleEnd - sampleStart) / 1000).toFixed(1)}s)`);

    const manifest = await (await fetch(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`)).json();
    const displaysById = new Map(manifest.displays.map((display) => [display.id, display]));
    const displayEntries = [...pages.values()];
    const eventsByPage = await Promise.all(
      displayEntries.map((entry) => entry.page.evaluate(() => window.__signage.events.map((event) => ({ ...event })))),
    );
    const allEvents = eventsByPage.flat();

    let sampleMismatches = 0;
    let sampledRows = 0;
    for (const sample of samples) {
      for (const row of sample.rows) {
        if (!row.displayId || row.slot == null || row.imageIndex == null) continue;
        sampledRows += 1;
        const display = displaysById.get(row.displayId);
        if (!display) continue;
        const expected = ((display.startIndex + display.step * row.slot) % manifest.playlist.items.length + manifest.playlist.items.length) % manifest.playlist.items.length;
        if (row.imageIndex !== expected) sampleMismatches += 1;
      }
    }
    const sequenceMismatches = [];
    for (const event of allEvents) {
      if (event.slot == null || event.imageIndex == null) continue;
      const display = displaysById.get(event.displayId);
      if (!display) continue;
      const expected = ((display.startIndex + display.step * event.slot) % manifest.playlist.items.length + manifest.playlist.items.length) % manifest.playlist.items.length;
      if (event.imageIndex !== expected) {
        sequenceMismatches.push({ displayId: event.displayId, slot: event.slot, imageIndex: event.imageIndex, expected, event });
      }
    }
    const transitionEvents = allEvents.filter((event) => !event.initial && event.slot != null);
    const bySlot = new Map();
    for (const event of transitionEvents) {
      if (!bySlot.has(event.slot)) bySlot.set(event.slot, []);
      bySlot.get(event.slot).push(event);
    }
    const spreads = [];
    const fullSpreads = [];
    const lags = [];
    for (const [slot, events] of bySlot) {
      const times = events.map((event) => event.appliedAtMs);
      const spread = Math.max(...times) - Math.min(...times);
      spreads.push(spread);
      if (new Set(events.map((event) => event.displayId)).size === pages.size) fullSpreads.push(spread);
      for (const event of events) lags.push(Math.max(0, event.lagMs ?? 0));
    }
    report.sequence = {
      samples: samples.length,
      sampledRows,
      sampleMismatches,
      events: allEvents.length,
      transitionEvents: transitionEvents.length,
      sequenceMismatches: sequenceMismatches.length,
      mismatchExamples: sequenceMismatches.slice(0, 5),
      sampleDurationMs: sampleEnd - sampleStart,
    };
    report.drift = {
      maxSpreadMs: spreads.length ? Math.max(...spreads) : null,
      meanSpreadMs: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null,
      maxFullCohortSpreadMs: fullSpreads.length ? Math.max(...fullSpreads) : null,
      fullCohortTransitions: fullSpreads.length,
      maxLagMs: lags.length ? Math.max(...lags) : null,
      p95LagMs: percentile(lags, 95),
      transitions: spreads.length,
      events: transitionEvents.slice(-40),
      note: 'Spread is the difference between the earliest and latest render application for the same synchronized slot across pages. Lag is applied time minus engine slot start.',
    };
    console.log(`[smoke] drift max spread=${report.drift.maxSpreadMs}ms full=${report.drift.maxFullCohortSpreadMs}ms maxLag=${report.drift.maxLagMs}ms`);
    console.log(`[smoke] sequence mismatches=${sequenceMismatches.length} sampledRows=${sampledRows}`);

    // Offline continuation and service-worker reload on a2.
    const a2 = pages.get('disp-a2');
    const beforeOfflineEvents = await a2.page.evaluate(() => window.__signage.events.length);
    await a2.context.setOffline(true);
    await a2.page.waitForFunction(() => window.__signage?.debugState().online === false, { timeout: 15_000 }).catch(() => {});
    const offlineStart = Date.now();
    await sleep(OFFLINE_MS);
    const offlineDebug = await a2.page.evaluate(() => window.__signage.debugState());
    const afterOfflineEvents = await a2.page.evaluate(() => window.__signage.events.length);
    const offlineBadgeVisible = await a2.page.locator('#offline-badge').isVisible().catch(() => false);
    let offlineReload = { attempted: false };
    if (offlineDebug.swControlled) {
      offlineReload.attempted = true;
      try {
        await a2.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await a2.page.waitForFunction(() => window.__signage?.ready === true, { timeout: 30_000 });
        const afterReload = await a2.page.evaluate(() => window.__signage.debugState());
        offlineReload.ok = afterReload.ready === true;
        offlineReload.online = afterReload.online;
        offlineReload.imageIndex = afterReload.imageIndex;
        offlineReload.slot = afterReload.slot;
      } catch (error) {
        offlineReload.ok = false;
        offlineReload.error = error.message;
      }
    }
    await a2.context.setOffline(false);
    const recovered = await a2.page
      .waitForFunction(() => window.__signage?.debugState().online === true, { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    report.offline = {
      durationMs: Date.now() - offlineStart,
      onlineDuringOffline: offlineDebug.online,
      offlineBadgeVisible,
      eventsBefore: beforeOfflineEvents,
      eventsAfter: afterOfflineEvents,
      continuedRendering: afterOfflineEvents > beforeOfflineEvents,
      serviceWorkerReload: offlineReload,
      recoveredOnline: recovered,
    };
    console.log(`[smoke] offline continued=${report.offline.continuedRendering} reload=${offlineReload.ok} recovered=${recovered}`);

    // Server restart with the same state file and same port.
    const epochBefore = (await (await fetch(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`)).json()).epoch;
    const a1 = pages.get('disp-a1');
    const port = server.port;
    await server.close();
    const offlineDetected = await a1.page
      .waitForFunction(() => window.__signage?.debugState().online === false, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(4000);
    server = await startServer({ port, statePath, quiet: true });
    const onlineRecovered = await a1.page
      .waitForFunction(() => window.__signage?.debugState().online === true, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const restoredManifest = await (await fetch(`${server.url}/api/sites/site-a/manifest?displayId=disp-a1`)).json();
    report.serverRestart = {
      offlineDetected,
      onlineRecovered,
      epochBefore,
      epochAfter: restoredManifest.epoch,
      epochStable: restoredManifest.epoch === epochBefore,
      version: restoredManifest.version,
    };
    console.log(`[smoke] restart offline=${offlineDetected} recovered=${onlineRecovered} epochStable=${report.serverRestart.epochStable}`);

    await sleep(1200);
    for (const [displayId, entry] of pages) {
      await entry.page.evaluate(() => window.__signage.setDebug(true));
      const file = path.join(screenshotDir, `player-${shortId(displayId)}-debug.png`);
      await entry.page.screenshot({ path: file });
      report.screenshots.push(path.relative(artifactDir, file).replaceAll('\\', '/'));
    }
    await pages.get('disp-a1').page.evaluate(() => window.__signage.setDebug(false));
    await pages.get('disp-a1').page.screenshot({ path: path.join(screenshotDir, 'player-a1-clean.png') });
    report.screenshots.push('screenshots/player-a1-clean.png');

    const previewContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(previewContext);
    const previewPage = await previewContext.newPage();
    previewPage.on('pageerror', (error) => allPageErrors.push({ label: 'preview', message: error.message }));
    previewPage.on('console', (message) => {
      if (message.type() === 'error') allConsoleErrors.push({ label: 'preview', text: message.text() });
    });
    await previewPage.goto(`${server.url}/preview/?site=site-a`, { waitUntil: 'networkidle', timeout: 30_000 });
    await previewPage.waitForFunction(() => document.querySelectorAll('.monitor').length >= 4, { timeout: 20_000 });
    await sleep(1200);
    await previewPage.screenshot({ path: path.join(screenshotDir, 'preview-site-a.png'), fullPage: true });
    report.screenshots.push('screenshots/preview-site-a.png');
    await previewPage.selectOption('#mode-select', 'canvas');
    await previewPage.fill('#display-count', '8');
    await previewPage.dispatchEvent('#display-count', 'change');
    await previewPage.selectOption('#image-count', '10');
    await previewPage.selectOption('#fit-select', 'cover');
    await sleep(1000);
    await previewPage.screenshot({ path: path.join(screenshotDir, 'preview-canvas-8.png'), fullPage: true });
    report.screenshots.push('screenshots/preview-canvas-8.png');

    report.consoleErrors = allConsoleErrors.slice(0, 100);
    report.pageErrors = allPageErrors;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    report.serverUrl = server.url;
    const pass =
      report.pages.length === 4 &&
      report.pages.every((page) => page.ready) &&
      report.sequence.sampleDurationMs >= 60_000 &&
      report.sequence.sampleMismatches === 0 &&
      report.sequence.sequenceMismatches === 0 &&
      report.drift.maxSpreadMs !== null &&
      report.drift.maxSpreadMs <= 200 &&
      report.lateJoin?.match === true &&
      report.offline.continuedRendering === true &&
      report.offline.serviceWorkerReload.ok === true &&
      report.offline.recoveredOnline === true &&
      report.serverRestart.offlineDetected === true &&
      report.serverRestart.onlineRecovered === true &&
      report.serverRestart.epochStable === true &&
      report.pageErrors.length === 0;
    report.pass = pass;
    await fs.writeFile(path.join(artifactDir, 'browser-smoke.json'), JSON.stringify(report, null, 2));
    console.log(`[smoke] ${pass ? 'PASS' : 'FAIL'} maxSpread=${report.drift.maxSpreadMs}ms written to artifacts/browser-smoke.json`);
    process.exitCode = pass ? 0 : 1;
  } catch (error) {
    report.error = error.stack ?? error.message;
    report.pass = false;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    await fs.writeFile(path.join(artifactDir, 'browser-smoke.json'), JSON.stringify(report, null, 2));
    console.error('[smoke] failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main();
