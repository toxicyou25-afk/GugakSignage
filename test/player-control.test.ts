/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { loadConfig } from '../src/config.js';
import {
  playerCommandPath,
  playerStatePath,
  serverInstancePath,
  readPlayerState,
  requestPlayerLaunch,
  requestPlayerStop,
} from '../src/player-control.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-player-control-'));
const config = loadConfig({
  rootDir: path.resolve(import.meta.dirname, '..'),
  dataDir: tempDir,
  dbPath: path.join(tempDir, 'test.sqlite'),
  uploadDir: path.join(tempDir, 'uploads'),
  port: 3456,
  seedSamples: false,
});

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('기기 실행 요청은 관리자 제어 파일에 로컬 재생기 URL과 함께 기록된다', () => {
  const result = requestPlayerLaunch(config, {
    id: 'device-1',
    name: '로비 화면',
    pairing_code: 'GUGAK1',
  });
  const command = JSON.parse(fs.readFileSync(playerCommandPath(tempDir), 'utf8'));
  assert.equal(command.action, 'launch');
  assert.equal(command.deviceId, 'device-1');
  assert.equal(command.deviceName, '로비 화면');
  const serverInstance = JSON.parse(fs.readFileSync(serverInstancePath(tempDir), 'utf8'));
  assert.equal(command.serverInstanceId, serverInstance.id);
  assert.equal(serverInstance.pid, process.pid);
  assert.equal(command.playerUrl, 'http://127.0.0.1:3456/player/?code=GUGAK1&reconnect=1');
  assert.equal(result.command.id, command.id);
  assert.equal(result.state.desired, 'stopped');
});

test('재생기 실행 명령은 물리 화면 배정을 함께 보존한다', () => {
  const screenTargets = [
    { displayId: 'display-a', nativeMonitorId: 'MONITOR\\ABC', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { displayId: 'display-b', nativeMonitorId: 'MONITOR\\DEF', bounds: { x: 0, y: 0, width: 1080, height: 1920 } },
  ];
  const result = requestPlayerLaunch(config, {
    id: 'device-1',
    name: '로비 화면',
    pairing_code: 'GUGAK1',
  }, screenTargets);
  const command = JSON.parse(fs.readFileSync(playerCommandPath(tempDir), 'utf8'));
  assert.deepEqual(command.screenTargets, screenTargets);
  assert.deepEqual(result.command.screenTargets, screenTargets);
});

test('현재 모니터가 분리돼도 안정 ID 배정은 launch 명령에 남긴다', () => {
  const screenTargets = [{ displayId: 'display-a', nativeMonitorId: 'MONITOR\\ABC' }];
  const result = requestPlayerLaunch(config, {
    id: 'device-1',
    name: '로비 화면',
    pairing_code: 'GUGAK1',
  }, screenTargets);
  const command = JSON.parse(fs.readFileSync(playerCommandPath(tempDir), 'utf8'));
  assert.deepEqual(command.screenTargets, screenTargets);
  assert.deepEqual(result.command.screenTargets, screenTargets);
});

test('512자 이내 Windows 물리 모니터 ID는 Manager API와 Player launch에서 동일하게 보존한다', () => {
  const nativeMonitorId = `MONITOR\\${'A'.repeat(250)}`;
  const result = requestPlayerLaunch(config, {
    id: 'device-long-monitor-id',
    name: '장치',
    pairing_code: 'GUGAK2',
  }, [{ displayId: 'display-long-id', nativeMonitorId }]);
  const command = JSON.parse(fs.readFileSync(playerCommandPath(tempDir), 'utf8'));
  assert.equal(command.screenTargets[0].nativeMonitorId, nativeMonitorId);
  assert.equal(result.command.screenTargets[0].nativeMonitorId, nativeMonitorId);
});

test('watchdog 재시작 상태는 물리 화면 배정을 유지하고 구버전 상태는 빈 배정으로 읽는다', () => {
  const screenTargets = [
    { displayId: 'display-a', nativeMonitorId: 'MONITOR\\ABC', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  ];
  fs.mkdirSync(path.dirname(playerStatePath(tempDir)), { recursive: true });
  fs.writeFileSync(playerStatePath(tempDir), JSON.stringify({
    schemaVersion: 1,
    desired: 'running',
    running: true,
    pid: 4242,
    startedAt: '2026-11-25T00:00:00.000Z',
    deviceId: 'device-1',
    playerUrl: 'http://127.0.0.1:3456/player/?code=GUGAK1',
    screenTargets,
    lastError: null,
    updatedAt: '2026-11-25T00:00:01.000Z',
  }), 'utf8');
  assert.deepEqual(readPlayerState(tempDir).screenTargets, screenTargets);

  fs.writeFileSync(playerStatePath(tempDir), JSON.stringify({ desired: 'running', running: true, pid: 4242 }), 'utf8');
  assert.deepEqual(readPlayerState(tempDir).screenTargets, []);
});

test('중지 요청은 별도 명령으로 기록한다', () => {
  requestPlayerStop(config);
  const command = JSON.parse(fs.readFileSync(playerCommandPath(tempDir), 'utf8'));
  assert.equal(command.action, 'stop');
  assert.equal(command.deviceId, null);
});

test('watchdog이 기록한 player-state를 관리자 상태로 정규화한다', () => {
  fs.mkdirSync(path.dirname(playerStatePath(tempDir)), { recursive: true });
  fs.writeFileSync(playerStatePath(tempDir), JSON.stringify({
    schemaVersion: 1,
    desired: 'running',
    running: true,
    pid: 4242,
    startedAt: '2026-11-25T00:00:00.000Z',
    deviceId: 'device-1',
    playerUrl: 'http://127.0.0.1:3456/player/?code=GUGAK1',
    lastError: null,
    updatedAt: '2026-11-25T00:00:01.000Z',
  }), 'utf8');
  assert.deepEqual(readPlayerState(tempDir), {
    schemaVersion: 1,
    desired: 'running',
    running: true,
    pid: 4242,
    startedAt: '2026-11-25T00:00:00.000Z',
    deviceId: 'device-1',
    playerUrl: 'http://127.0.0.1:3456/player/?code=GUGAK1',
    screenTargets: [],
    lastError: null,
    updatedAt: '2026-11-25T00:00:01.000Z',
  });

  fs.writeFileSync(playerStatePath(tempDir), JSON.stringify({ desired: 'running', running: true, pid: null }), 'utf8');
  const stopped = readPlayerState(tempDir);
  assert.equal(stopped.desired, 'running');
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
});
