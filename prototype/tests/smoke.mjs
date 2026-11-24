// SPDX-License-Identifier: Apache-2.0
// Optional smoke test. Install Playwright separately (see README.md).

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage();
page.setDefaultTimeout(12000);

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

const wait = (ms = 250) => page.waitForTimeout(ms);
const nav = async (hash) => {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await wait(300);
};

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('h1').innerText(), '오늘의 게시 상태');

  const type = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      size: parseFloat(style.fontSize),
      line: parseFloat(style.lineHeight),
      break: style.wordBreak,
      numbers: style.fontVariantNumeric
    };
  });
  assert.ok(type.size >= 17, 'body should be 17px or larger');
  assert.ok(type.line / type.size >= 1.5, 'line height should be 150% or more');
  assert.equal(type.break, 'keep-all');
  assert.ok(type.numbers.includes('tabular-nums'));

  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('skip-link')), true);
  const hashBeforeSkip = await page.evaluate(() => location.hash);
  await page.keyboard.press('Enter');
  await wait(150);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  assert.equal(await page.evaluate(() => location.hash), hashBeforeSkip);

  await page.getByRole('button', { name: '시나리오', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '6대' }).click();
  await wait();
  await nav('#/site/site-a');
  assert.equal(await page.locator('.monitor-node').count(), 6);
  await page.getByRole('button', { name: '시나리오', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '0장' }).click();
  await wait();
  await nav('#/playback');
  assert.ok(await page.getByText('재생할 이미지 없음').first().isVisible());
  await page.getByRole('button', { name: '시나리오', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /처음 상태로 돌아가기/ }).click();
  await wait();

  await nav('#/register');
  const pendingBefore = await page.locator('.pending-card').count();
  await page.getByRole('button', { name: /이 브라우저로 테스트/ }).click();
  await wait(200);
  const browserCode = await page.locator('.browser-test__code strong').innerText();
  assert.match(browserCode, /^\d{6}$/);
  await page.getByRole('button', { name: /등록 대기로 보내기/ }).click();
  await wait(300);
  assert.equal(await page.locator('.pending-card').count(), pendingBefore + 1);
  const browserPending = page.locator('.pending-card').filter({ hasText: browserCode });
  await browserPending.getByRole('button', { name: /승인/ }).click();
  await page.getByRole('button', { name: /승인하고 연결하기/ }).click();
  await wait();
  assert.equal(await page.locator('.pending-card').count(), pendingBefore);

  await page.locator('#manual-code').fill('111111');
  await page.locator('#manual-code-form').getByRole('button', { name: /등록 대기 보내기/ }).click();
  await wait();
  assert.equal(await page.locator('#registration-error').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'manual-code');
  await page.locator('#manual-code').fill('135790');
  await page.locator('#manual-code-form').getByRole('button', { name: /등록 대기 보내기/ }).click();
  await wait();
  await page.locator('.pending-card').filter({ hasText: '135790' }).getByRole('button', { name: /승인/ }).click();
  await page.getByRole('button', { name: /승인하고 연결하기/ }).click();
  await wait();

  await nav('#/library');
  const upload = await page.screenshot({ clip: { x: 280, y: 220, width: 640, height: 360 }, type: 'png' });
  await page.locator('#asset-upload').setInputFiles({ name: 'smoke-upload.png', mimeType: 'image/png', buffer: upload });
  await wait(800);
  const uploadedCard = page.locator('[data-asset-card]').filter({ hasText: 'smoke upload' }).first();
  assert.ok(await uploadedCard.isVisible());
  await uploadedCard.getByRole('button', { name: /자세히/ }).click();
  await wait();
  assert.ok((await page.locator('.target-check').count()) > 0);
  assert.equal(await page.locator('.target-check .safe-area').count(), await page.locator('.target-check').count());
  await page.keyboard.press('Escape');
  await uploadedCard.getByRole('button', { name: /삭제/ }).click();
  await page.getByRole('button', { name: /^삭제하기$/ }).click();
  await wait();
  assert.equal(await page.getByText('smoke upload', { exact: true }).count(), 0);

  await nav('#/site/site-a');
  const firstNode = page.locator('.monitor-node').first();
  await firstNode.focus();
  await page.keyboard.press('ArrowRight');
  await wait();
  assert.ok((await page.evaluate(() => document.activeElement.className)).includes('monitor-node'));
  const box = await page.locator('.monitor-node').first().boundingBox();
  const originalLeft = await page.locator('.monitor-node').first().evaluate((el) => el.style.left);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await wait();
  assert.equal(await page.locator('.monitor-node').first().evaluate((el) => el.style.left), originalLeft);
  const countBeforeAdd = await page.locator('.monitor-node').count();
  await page.getByRole('button', { name: '화면 추가' }).first().click();
  await wait();
  assert.equal(await page.locator('.monitor-node').count(), countBeforeAdd + 1);
  await page.getByRole('button', { name: '배치 실행 취소' }).click();
  await wait();
  assert.equal(await page.locator('.monitor-node').count(), countBeforeAdd);

  await nav('#/playback');
  await page.locator('input[name="playback-mode"][value="mirror"]').check();
  await wait();
  assert.equal(await page.locator('select[data-field="start-offset"]').first().isDisabled(), true);
  await page.locator('input[name="playback-mode"][value="cycle"]').check();
  await wait();
  const firstImage = await page.locator('.playlist-row__name strong').first().innerText();
  await page.getByRole('button', { name: new RegExp(firstImage + ' 아래로 이동') }).click();
  await wait();
  assert.notEqual(await page.locator('.playlist-row__name strong').first().innerText(), firstImage);
  await page.locator('#fallback-image').selectOption('img-instruments');
  await wait();
  assert.equal(await page.locator('#fallback-image').inputValue(), 'img-instruments');
  assert.ok((await page.locator('.pattern-table th[scope="row"]').count()) > 0);

  await nav('#/preview');
  const versionBefore = Number((await page.locator('.publish-fact').filter({ hasText: '버전' }).innerText()).match(/\d+ → (\d+)/)[1]);
  await wait(700);
  await page.getByRole('button', { name: '일시정지' }).click();
  const paused = await page.locator('#preview-time').innerText();
  await wait(600);
  assert.equal(await page.locator('#preview-time').innerText(), paused);
  await page.locator('#preview-scrub').fill('4');
  await wait();
  assert.ok((await page.locator('#preview-time').innerText()).startsWith('00:04'));
  await page.getByRole('button', { name: /이대로 게시/ }).first().click();
  await page.getByRole('button', { name: /새 버전 게시/ }).click();
  await wait();
  const versionAfter = Number((await page.locator('.publish-fact').filter({ hasText: '버전' }).innerText()).match(/\d+ → (\d+)/)[1]);
  assert.equal(versionAfter, versionBefore + 1);

  await nav('#/status');
  assert.ok((await page.locator('.status-sentence strong').innerText()).includes('대 중'));
  await page.getByRole('button', { name: /^오프라인 2$/ }).click();
  await wait();
  await page.getByRole('button', { name: '상세', exact: true }).first().click();
  await wait();
  for (let index = 0; index < 10; index += 1) await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))));
  await page.keyboard.press('Escape');
  await wait();
  await page.getByRole('button', { name: '상세', exact: true }).first().click();
  await page.getByRole('button', { name: /다시 연결/ }).click();
  await wait();
  assert.equal(await page.getByRole('button', { name: /^오프라인 1$/ }).count(), 1);

  await nav('#/dashboard');
  await page.getByRole('button', { name: '새 장소 만들기' }).first().click();
  await wait();
  await page.locator('#wizard-site-name').fill('스모크 테스트 장소');
  await page.getByRole('button', { name: /다음 단계/ }).click();
  await wait();
  await page.getByRole('link', { name: '나가기' }).click();
  await wait();
  assert.ok(await page.getByText('초안이 저장되어 있습니다.').isVisible());
  await page.getByRole('button', { name: /이어서 하기/ }).click();
  await wait();
  assert.equal(await page.locator('#wizard-step-title').innerText(), '화면은 몇 대인가요?');
  await page.getByRole('button', { name: /초안 버리기/ }).first().click();
  await page.getByRole('button', { name: '초안 버리기', exact: true }).last().click();
  await wait();

  await page.setViewportSize({ width: 768, height: 1000 });
  for (const hash of ['#/dashboard', '#/site/site-a', '#/register', '#/library', '#/playback', '#/preview', '#/status']) {
    await nav(hash);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `${hash} has horizontal overflow: ${overflow}`);
  }

  assert.deepEqual(consoleErrors, [], `console errors: ${JSON.stringify(consoleErrors)}`);
  console.log('Smoke test passed: dashboard, scenarios, registration, upload, layout, playback, preview, status, draft, 768px.');
} finally {
  await browser.close();
}
