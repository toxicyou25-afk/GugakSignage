/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { assertManagerPasswordChanged } from './auth.js';
import { backfillContentChecksums } from './content-integrity.js';
import { isLoopbackBindHost } from './admin-access.js';
import { initializeAdminPassword, usesTestDefaultAdminPassword } from './admin-password.js';
import { createApp } from './app.js';
import { loadConfig, loadTlsOptions } from './config.js';
import { openDatabase } from './db.js';
import { loadLocalEnv } from './env.js';
import { startPlayerHost } from './player-host-main.js';
import { migrateSampleCode, seedDatabase } from './seed.js';
import { ensureDeviceTopology } from './topology-migration.js';

loadLocalEnv();
const config = loadConfig();
if (config.role === 'player') {
  const closePlayerHost = await startPlayerHost();
  console.log(`[signage] Player Host listening at http://127.0.0.1:${process.env.GUGAK_PLAYER_HOST_PORT || '43127'}/player/`);
  let closing = false;
  const shutdownPlayerHost = () => {
    if (closing) return;
    closing = true;
    void closePlayerHost().then(() => { process.exitCode = 0; }, (error: unknown) => {
      console.error('Player Host shutdown failed', error);
      process.exitCode = 1;
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.once('SIGINT', shutdownPlayerHost);
  process.once('SIGTERM', shutdownPlayerHost);
} else {
const httpsManager = config.role === 'manager' && config.mode !== 'standalone';
const tlsOptions = httpsManager ? loadTlsOptions(config) : undefined;
if (
  process.env.GUGAK_INSTALLED === '1' &&
  (config.adminPassword === 'gugak1234' || config.sessionSecret === 'gugak-signage-local-development-secret')
) {
  throw new Error('설치 모드에서는 개발용 기본 관리자 비밀번호와 세션 시크릿을 사용할 수 없습니다. 데이터 폴더의 .env를 확인하세요.');
}
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
const db = openDatabase(config.dbPath);
initializeAdminPassword(db, config);
const checksumMigration = await backfillContentChecksums(db, config.uploadDir);
if (checksumMigration.skipped > 0) {
  console.warn(`[integrity] ${checksumMigration.skipped}개 기존 콘텐츠는 파일 확인이 불가능해 checksum을 설정하지 않았습니다.`);
}
if (httpsManager && usesTestDefaultAdminPassword(db)) {
  db.close();
  assertManagerPasswordChanged(true);
}
const sampleCodeMigrated = migrateSampleCode(db);
const seedResult = seedDatabase(db, config);
if (seedResult.deviceId) ensureDeviceTopology(db, seedResult.deviceId);
const app = createApp(db, config);
const server = httpsManager ? https.createServer(tlsOptions!, app) : http.createServer(app);
const localOnlyAdmin = usesTestDefaultAdminPassword(db);

if (localOnlyAdmin) {
  console.warn('[security] Test default administrator password is still in use; non-loopback administrator requests are denied until it is changed.');
  if (!isLoopbackBindHost(config.host)) {
    console.warn(`[security] HOST=${config.host} is not loopback. Player/content routes may be reachable on the LAN; administrator routes stay local-only until the stored password is changed.`);
  }
}

server.listen(config.port, config.host, () => {
  const localAddress = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`[signage] 서버 시작 · ${new Date().toISOString()}`);
  const scheme = httpsManager ? 'https' : 'http';
  console.log(`[signage] 관리 화면: ${scheme}://${localAddress}:${config.port}/admin/`);
  console.log(`[signage] 재생기: ${scheme}://${localAddress}:${config.port}/player/`);
  console.log(`[signage] 데이터베이스: ${config.dbPath}`);
  console.log(`[signage] 업로드 폴더: ${config.uploadDir}`);
  if (seedResult.seeded && seedResult.pairingCode) {
    console.log(`[signage] 샘플 기기 등록 코드: ${seedResult.pairingCode}`);
    console.log(`[signage] 샘플 재생기 주소: ${scheme}://${localAddress}:${config.port}/player/?code=${seedResult.pairingCode}`);
  }
  if (sampleCodeMigrated) {
    console.log('[signage] 기존 샘플 기기 코드를 GUGAK1로 갱신했습니다.');
  }
});

function shutdown(signal: string): void {
  console.log(`[signage] ${signal} 수신 · 종료합니다.`);
  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
}
