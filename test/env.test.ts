/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { loadLocalEnv } from '../src/env.js';

test('.env 파일을 서버 설정 생성 전에 읽는다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-env-'));
  const envPath = path.join(tempDir, '.env');
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const previousDataDir = process.env.DATA_DIR;
  try {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.DATA_DIR;
    fs.writeFileSync(
      envPath,
      'ADMIN_PASSWORD=env-file-review-password\nDATA_DIR=env-file-data\n',
      'utf8',
    );
    assert.equal(loadLocalEnv(envPath), true);
    const config = loadConfig();
    assert.equal(config.adminPassword, 'env-file-review-password');
    assert.equal(config.dataDir, path.resolve('env-file-data'));
    assert.equal(loadLocalEnv(path.join(tempDir, 'missing.env')), false);
  } finally {
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GUGAK_ENV_FILE은 설치된 서버의 환경 파일 위치를 지정한다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-env-file-'));
  const envPath = path.join(tempDir, 'installed.env');
  const previousEnvFile = process.env.GUGAK_ENV_FILE;
  const previousPort = process.env.PORT;
  try {
    fs.writeFileSync(envPath, 'PORT=43210\n', 'utf8');
    process.env.GUGAK_ENV_FILE = envPath;
    delete process.env.PORT;
    assert.equal(loadLocalEnv(), true);
    assert.equal(process.env.PORT, '43210');
  } finally {
    if (previousEnvFile === undefined) delete process.env.GUGAK_ENV_FILE;
    else process.env.GUGAK_ENV_FILE = previousEnvFile;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
