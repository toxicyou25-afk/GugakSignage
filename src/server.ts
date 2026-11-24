/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { loadLocalEnv } from './env.js';
import { migrateSampleCode, seedDatabase } from './seed.js';

loadLocalEnv();
const config = loadConfig();
if (
  process.env.GUGAK_INSTALLED === '1' &&
  (config.adminPassword === 'gugak1234' || config.sessionSecret === 'gugak-signage-local-development-secret')
) {
  throw new Error('설치 모드에서는 개발용 기본 관리자 비밀번호와 세션 시크릿을 사용할 수 없습니다. 데이터 폴더의 .env를 확인하세요.');
}
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
const db = openDatabase(config.dbPath);
const sampleCodeMigrated = migrateSampleCode(db);
const seedResult = seedDatabase(db, config);
const app = createApp(db, config);
const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  const localAddress = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`[signage] 서버 시작 · ${new Date().toISOString()}`);
  console.log(`[signage] 관리 화면: http://${localAddress}:${config.port}/admin/`);
  console.log(`[signage] 재생기: http://${localAddress}:${config.port}/player/`);
  console.log(`[signage] 데이터베이스: ${config.dbPath}`);
  console.log(`[signage] 업로드 폴더: ${config.uploadDir}`);
  if (seedResult.seeded && seedResult.pairingCode) {
    console.log(`[signage] 샘플 기기 등록 코드: ${seedResult.pairingCode}`);
    console.log(`[signage] 샘플 재생기 주소: http://${localAddress}:${config.port}/player/?code=${seedResult.pairingCode}`);
  }
  if (sampleCodeMigrated) {
    console.log('[signage] 기존 샘플 기기 코드를 GUGAK1로 갱신했습니다.');
  }
  if (config.adminPassword === 'gugak1234') {
    console.log('[signage] 개발/샘플 모드 초기 비밀번호: gugak1234 · 운영 전 ADMIN_PASSWORD를 바꾸세요.');
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
