/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';

export interface AppConfig {
  rootDir: string;
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  uploadDir: string;
  adminPassword: string;
  sessionSecret: string;
  maxUploadBytes: number;
  seedSamples: boolean;
  heartbeatOnlineMs: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const rootDir = path.resolve(process.cwd());
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
  const config: AppConfig = {
    rootDir,
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    dbPath: path.resolve(process.env.DB_PATH || path.join(dataDir, 'signage.sqlite')),
    uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
    adminPassword: process.env.ADMIN_PASSWORD || 'gugak1234',
    sessionSecret: process.env.SESSION_SECRET || 'gugak-signage-local-development-secret',
    maxUploadBytes: intFromEnv('MAX_UPLOAD_MB', 300) * 1024 * 1024,
    seedSamples: process.env.SEED_SAMPLES !== 'false',
    heartbeatOnlineMs: intFromEnv('HEARTBEAT_ONLINE_SECONDS', 45) * 1000,
    ...overrides,
  };
  if (overrides.dataDir && !overrides.dbPath) {
    config.dbPath = path.join(config.dataDir, 'signage.sqlite');
  }
  if (overrides.dataDir && !overrides.uploadDir) {
    config.uploadDir = path.join(config.dataDir, 'uploads');
  }
  return config;
}
