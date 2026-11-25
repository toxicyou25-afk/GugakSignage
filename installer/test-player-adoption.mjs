// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAdoptedPlayerStillOwned, verifyPlayerProcessIdentity } from './ops/player-adoption.mjs';

const browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profileDir = 'C:\\Users\\operator\\AppData\\Local\\GugakSignagePlayer';
const playerUrl = 'http://127.0.0.1:3000/player/?code=GUGAK1&reconnect=1';
const startedAt = '2026-11-25T01:02:03.000Z';

function processInfo(overrides = {}) {
  return {
    executablePath: browserPath,
    commandLine: `"${browserPath}" --user-data-dir=${profileDir} --remote-debugging-port=9222 --app=${playerUrl}`,
    creationDate: startedAt,
    ...overrides,
  };
}

test('채택은 executable·profile·debug port·player URL·시작 시각·CDP 페이지가 모두 맞아야 한다', () => {
  const cdpTargets = [
    { type: 'background_page', url: 'edge://background' },
    { type: 'page', url: playerUrl },
  ];
  const ok = verifyPlayerProcessIdentity({
    processInfo: processInfo(),
    cdpTargets,
    browserPath,
    profileDir,
    debugPort: 9222,
    playerUrl,
    startedAt,
  });
  assert.deepEqual(ok, { ok: true, reasons: [] });

  const wrong = verifyPlayerProcessIdentity({
    processInfo: processInfo({
      executablePath: 'C:\\Windows\\System32\\notepad.exe',
      commandLine: `"C:\\Windows\\System32\\notepad.exe" ${profileDir}`,
      creationDate: '2026-11-25T00:00:00.000Z',
    }),
    cdpTargets: [],
    browserPath,
    profileDir,
    debugPort: 9222,
    playerUrl,
    startedAt,
  });
  assert.equal(wrong.ok, false);
  for (const reason of ['executable-mismatch', 'debug-port-mismatch', 'player-url-mismatch', 'start-time-mismatch', 'cdp-player-target-missing']) {
    assert.ok(wrong.reasons.includes(reason), `${reason}: ${wrong.reasons.join(',')}`);
  }
});

test('채택 후 종료 전 재검사는 CDP 상태와 무관하게 프로세스 신원을 다시 확인한다', () => {
  const stillOwned = verifyAdoptedPlayerStillOwned({
    processInfo: processInfo(),
    browserPath,
    profileDir,
    debugPort: 9222,
    playerUrl,
    startedAt,
  });
  assert.equal(stillOwned.ok, true);
  const reused = verifyAdoptedPlayerStillOwned({
    processInfo: processInfo({ executablePath: 'C:\\Windows\\System32\\notepad.exe' }),
    browserPath,
    profileDir,
    debugPort: 9222,
    playerUrl,
    startedAt,
  });
  assert.equal(reused.ok, false);
  assert.ok(reused.reasons.includes('executable-mismatch'));
});
