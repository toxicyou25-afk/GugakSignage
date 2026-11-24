// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPlayerState } from './ops/watchdog-health.mjs';

const now = Date.parse('2026-11-24T12:00:00.000Z');

test('watchdog은 실제 재생과 캐시 재생만 정상으로 판정한다', () => {
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: false, lastHeartbeatAt: '2026-11-24T11:59:30.000Z' },
    }, 60_000),
    { kind: 'playing', responsive: true, healthy: true, actionable: false },
  );
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: true, lastHeartbeatAt: null },
    }, 60_000),
    { kind: 'cached', responsive: true, healthy: true, actionable: false },
  );
});

test('페어링·오류·대기 화면은 응답 상태이지만 정상 재생으로 오판하지 않는다', () => {
  for (const [state, kind] of [
    [{ currentContentId: null, deviceId: null, lastError: null }, 'pairing'],
    [{ currentContentId: null, deviceId: 'device-1', lastError: 'manifest failed' }, 'error-screen'],
    [{ currentContentId: null, deviceId: 'device-1', lastError: null }, 'waiting'],
  ]) {
    assert.deepEqual(
      classifyPlayerState({ playerReady: true, now, state }, 60_000),
      { kind, responsive: true, healthy: false, actionable: false },
    );
  }
});

test('온라인 재생의 오래된 하트비트와 플레이어 미준비는 재시작 대상으로 판정한다', () => {
  assert.deepEqual(
    classifyPlayerState({
      playerReady: true,
      now,
      state: { currentContentId: 'content-1', offline: false, lastHeartbeatAt: '2026-11-24T11:55:00.000Z' },
    }, 60_000),
    { kind: 'playback-stalled', responsive: true, healthy: false, actionable: true },
  );
  assert.deepEqual(
    classifyPlayerState({ playerReady: false, state: null, now }, 60_000),
    { kind: 'not-ready', responsive: true, healthy: false, actionable: true },
  );
});
