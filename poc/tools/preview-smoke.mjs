// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../apps/server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(here, '../artifacts');
const screenshotDir = path.join(artifactDir, 'screenshots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function findPlaywright() {
  const candidates = ['playwright'];
  if (process.env.PLAYWRIGHT_MODULE) candidates.unshift(process.env.PLAYWRIGHT_MODULE);
  const npxRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (npxRoot && (await exists(npxRoot))) {
    const packages = [];
    for (const entry of await fs.readdir(npxRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(npxRoot, entry.name, 'node_modules', 'playwright', 'index.mjs');
      if (await exists(file)) packages.push({ file, mtime: (await fs.stat(file)).mtimeMs });
    }
    packages.sort((a, b) => b.mtime - a.mtime);
    candidates.push(...packages.map((entry) => entry.file));
  }
  for (const candidate of candidates) {
    try {
      return await import(candidate === 'playwright' ? candidate : pathToFileURL(candidate).href);
    } catch { /* next */ }
  }
  throw new Error('Playwright not found');
}

async function findChromium() {
  if (process.env.PLAYWRIGHT_CHROME && (await exists(process.env.PLAYWRIGHT_CHROME))) return process.env.PLAYWRIGHT_CHROME;
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
  if (root && (await exists(root))) {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) continue;
      for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const file = path.join(root, entry.name, relative);
        if (await exists(file)) return file;
      }
    }
  }
  return undefined;
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugak-preview-'));
  const server = await startServer({ port: 0, statePath: path.join(tempDir, 'state.json'), reset: true, quiet: true });
  const playwright = await findPlaywright();
  const browser = await playwright.chromium.launch({ headless: true, executablePath: await findChromium() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const scenarios = [];
  try {
    await page.goto(`${server.url}/preview/?site=site-a`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll('.monitor').length >= 4, { timeout: 20_000 });
    for (const mode of ['individual', 'synchronized-cycle', 'mirror', 'canvas']) {
      for (const displayCount of [1, 4, 8]) {
        for (const imageCount of ['0', '1', '3', '10']) {
          await page.selectOption('#mode-select', mode);
          await page.fill('#display-count', String(displayCount));
          await page.dispatchEvent('#display-count', 'change');
          await page.selectOption('#image-count', imageCount);
          await page.selectOption('#fit-select', mode === 'canvas' ? 'cover' : 'contain');
          await sleep(140);
          const result = await page.evaluate(() => ({
            monitors: document.querySelectorAll('.monitor').length,
            canvases: document.querySelectorAll('.monitor canvas').length,
            empties: document.querySelectorAll('.monitor.empty').length,
            warnings: document.querySelector('#warning-count').textContent,
            pattern: document.querySelector('#pattern-count').textContent,
            note: document.querySelector('#scenario-note').textContent,
            warningText: document.querySelector('#warnings').textContent,
          }));
          const expectedPeriod = (() => {
            const n = Number(imageCount);
            const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
            return n === 0 ? 0 : (n * displayCount) / gcd(n, displayCount);
          })();
          const ok = result.monitors === displayCount && result.canvases === displayCount && (expectedPeriod === 0 || result.pattern.startsWith(`${Math.min(expectedPeriod, 120)}/`));
          scenarios.push({ mode, displayCount, imageCount, ok, ...result, expectedPeriod });
        }
      }
    }

    await page.selectOption('#mode-select', 'canvas');
    await page.selectOption('#image-count', '10');
    await page.selectOption('#fit-select', 'cover');
    await page.fill('#display-count', '8');
    await page.dispatchEvent('#display-count', 'change');
    await sleep(500);
    await page.screenshot({ path: path.join(screenshotDir, 'preview-canvas-8.png'), fullPage: true });
    const plusBefore = await page.inputValue('#display-count');
    await page.click('#display-plus');
    await sleep(300);
    const plusAfter = await page.inputValue('#display-count');
    const plusMonitors = await page.locator('.monitor').count();
    await page.click('#display-minus');
    await sleep(300);
    const minusAfter = await page.inputValue('#display-count');
    const minusNote = await page.locator('#scenario-note').innerText();

    await page.fill('#display-count', '4');
    await page.dispatchEvent('#display-count', 'change');
    await page.click('#play-pause');
    await sleep(250);
    const pausedLabel = await page.locator('#play-pause').innerText();
    const sliderBefore = await page.inputValue('#scrub');
    await page.locator('#scrub').evaluate((input) => {
      input.value = String(Number(input.value) + 10_000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    const sliderAfter = await page.inputValue('#scrub');
    const timeLabel = await page.locator('#time-label').innerText();

    await page.goto(`${server.url}/preview/?site=site-d`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.monitor').length === 2, { timeout: 20_000 });
    await sleep(400);
    const emptySite = await page.evaluate(() => ({
      warnings: document.querySelector('#warning-count').textContent,
      warningText: document.querySelector('#warnings').textContent,
      note: document.querySelector('#scenario-note').textContent,
    }));
    await page.screenshot({ path: path.join(screenshotDir, 'preview-empty-site.png'), fullPage: true });

    const report = {
      generatedAt: new Date().toISOString(),
      pass: pageErrors.length === 0 && scenarios.every((scenario) => scenario.ok) && plusAfter === '9' && plusMonitors === 9 && Number(minusAfter) === 8 && pausedLabel.includes('재생') && sliderAfter === String(Number(sliderBefore) + 10_000),
      scenarios: scenarios.length,
      scenarioFailures: scenarios.filter((scenario) => !scenario.ok),
      interactions: { plusBefore, plusAfter, plusMonitors, minusAfter, minusNote, pausedLabel, sliderBefore, sliderAfter, timeLabel },
      emptySite,
      pageErrors,
      consoleErrors,
      screenshot: 'screenshots/preview-empty-site.png',
    };
    await fs.writeFile(path.join(artifactDir, 'preview-smoke.json'), JSON.stringify(report, null, 2));
    console.log(`Preview smoke: ${report.pass ? 'PASS' : 'FAIL'} (${scenarios.length} scenarios, ${scenarios.filter((s) => !s.ok).length} failures)`);
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
