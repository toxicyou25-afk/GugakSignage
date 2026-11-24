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
  assert.equal(command.playerUrl, 'http://127.0.0.1:3456/player/?code=GUGAK1&reconnect=1');
  assert.equal(result.command.id, command.id);
  assert.equal(result.state.desired, 'stopped');
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
    lastError: null,
    updatedAt: '2026-11-25T00:00:01.000Z',
  });

  fs.writeFileSync(playerStatePath(tempDir), JSON.stringify({ desired: 'running', running: true, pid: null }), 'utf8');
  const stopped = readPlayerState(tempDir);
  assert.equal(stopped.desired, 'running');
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
});
