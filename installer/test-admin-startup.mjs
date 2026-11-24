// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { adminUrl, openAdminOnStartup, shouldOpenAdminOnStartup } from './ops/admin-startup.mjs';
import { desiredAfterBrowserExit } from './ops/player-state.mjs';

test('관리자 페이지는 로그온 watchdog 시작마다 기본 창으로 연다', () => {
  assert.equal(shouldOpenAdminOnStartup(), true);
  assert.equal(shouldOpenAdminOnStartup({ enabled: true }), true);
  assert.equal(shouldOpenAdminOnStartup({ enabled: false }), false);
  assert.equal(shouldOpenAdminOnStartup({ headless: true }), false);
  assert.equal(shouldOpenAdminOnStartup({ alreadyAttempted: true }), false);
});

test('관리자 URL은 install.json 포트를 쓰고 잘못된 값은 3000으로 대체한다', () => {
  assert.equal(adminUrl(3128), 'http://127.0.0.1:3128/admin/');
  assert.equal(adminUrl(0), 'http://127.0.0.1:3000/admin/');
  assert.equal(adminUrl(70000), 'http://127.0.0.1:3000/admin/');
});

test('watchdog 시작당 한 번만 관리자 페이지를 연다', async () => {
  const opened = [];
  const state = { attempted: false };
  const options = {
    config: { adminAutoOpen: { enabled: true } },
    port: 3210,
    installDir: 'C:\\Program Files\\GugakSignage',
    state,
    launchImpl: async (url) => { opened.push(url); },
  };
  const first = await openAdminOnStartup(options);
  const second = await openAdminOnStartup(options);
  assert.equal(first.opened, true);
  assert.equal(first.url, 'http://127.0.0.1:3210/admin/');
  assert.equal(second.reason, 'already-attempted');
  assert.deepEqual(opened, ['http://127.0.0.1:3210/admin/']);
});

test('자동 열기를 끈 설정과 headless에서는 브라우저를 시작하지 않는다', async () => {
  const launches = [];
  const base = {
    port: 3000,
    installDir: 'C:\\GugakSignage',
    launchImpl: async (url) => { launches.push(url); },
  };
  const disabled = await openAdminOnStartup({
    ...base,
    config: { adminAutoOpen: { enabled: false } },
    state: { attempted: false },
  });
  assert.equal(disabled.reason, 'disabled');
  const headless = await openAdminOnStartup({
    ...base,
    config: { browserHeadless: true, adminAutoOpen: { enabled: true } },
    state: { attempted: false },
  });
  assert.equal(headless.reason, 'headless');
  assert.deepEqual(launches, []);
});

test('사용자가 재생기 창을 닫은 정상 종료는 재실행하지 않고 비정상 종료만 복구 의도를 유지한다', () => {
  assert.equal(desiredAfterBrowserExit({ desired: 'running', code: 0 }), 'stopped');
  assert.equal(desiredAfterBrowserExit({ desired: 'running', code: 1 }), 'running');
  assert.equal(desiredAfterBrowserExit({ desired: 'running', code: null, signal: 'SIGTERM' }), 'running');
  assert.equal(desiredAfterBrowserExit({ intentional: true, desired: 'stopped', code: 1 }), 'stopped');
});
