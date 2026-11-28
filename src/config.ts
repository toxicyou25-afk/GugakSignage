/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';
import fs from 'node:fs';
import type { ServerOptions } from 'node:https';

export type GugakRole = 'all' | 'manager' | 'player';
export type GugakMode = 'standalone' | 'lan' | 'central';

export interface AppConfig {
  rootDir: string;
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  uploadDir: string;
  adminPassword: string | undefined;
  databaseWasPresentAtStartup: boolean;
  sessionSecret: string;
  maxUploadBytes: number;
  seedSamples: boolean;
  heartbeatOnlineMs: number;
  role: GugakRole;
  mode: GugakMode;
  tlsCertFile?: string;
  tlsKeyFile?: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const roleValue = process.env.GUGAK_ROLE || 'all';
  const modeValue = process.env.GUGAK_MODE || 'standalone';
  if (roleValue !== 'all' && roleValue !== 'manager' && roleValue !== 'player') throw new Error('GUGAK_ROLE must be all, manager, or player.');
  if (modeValue !== 'standalone' && modeValue !== 'lan' && modeValue !== 'central') {
    throw new Error('GUGAK_MODE must be standalone, lan, or central.');
  }
  const role = roleValue as GugakRole;
  const mode = modeValue as GugakMode;
  if (role === 'all' && mode !== 'standalone') throw new Error('GUGAK_ROLE=all only supports GUGAK_MODE=standalone.');
  const host = process.env.HOST || '0.0.0.0';
  if (role === 'manager' && mode === 'standalone' && !isLoopbackHost(host)) {
    throw new Error('Standalone Manager mode requires HOST to be a loopback address.');
  }
  const tlsCertFile = process.env.GUGAK_TLS_CERT_FILE ? path.resolve(process.env.GUGAK_TLS_CERT_FILE) : undefined;
  const tlsKeyFile = process.env.GUGAK_TLS_KEY_FILE ? path.resolve(process.env.GUGAK_TLS_KEY_FILE) : undefined;
  if (role === 'manager' && mode !== 'standalone' && (!tlsCertFile || !tlsKeyFile)) {
    throw new Error('Manager LAN and central modes require GUGAK_TLS_CERT_FILE and GUGAK_TLS_KEY_FILE for HTTPS.');
  }
  const rootDir = path.resolve(process.cwd());
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
  const config: AppConfig = {
    rootDir,
    port: intFromEnv('PORT', 3000),
    host,
    dataDir,
    dbPath: path.resolve(process.env.DB_PATH || path.join(dataDir, 'signage.sqlite')),
    uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
    adminPassword: process.env.ADMIN_PASSWORD || undefined,
    databaseWasPresentAtStartup: false,
    sessionSecret: process.env.SESSION_SECRET || 'gugak-signage-local-development-secret',
    maxUploadBytes: intFromEnv('MAX_UPLOAD_MB', 300) * 1024 * 1024,
    seedSamples: process.env.SEED_SAMPLES !== 'false',
    heartbeatOnlineMs: intFromEnv('HEARTBEAT_ONLINE_SECONDS', 45) * 1000,
    role,
    mode,
    tlsCertFile,
    tlsKeyFile,
    ...overrides,
  };
  if (overrides.dataDir && !overrides.dbPath) {
    config.dbPath = path.join(config.dataDir, 'signage.sqlite');
  }
  if (overrides.dataDir && !overrides.uploadDir) {
    config.uploadDir = path.join(config.dataDir, 'uploads');
  }
  if (overrides.databaseWasPresentAtStartup !== undefined) {
    config.databaseWasPresentAtStartup = overrides.databaseWasPresentAtStartup;
  } else {
    try {
      config.databaseWasPresentAtStartup = fs.statSync(config.dbPath).size > 0;
    } catch {
      config.databaseWasPresentAtStartup = false;
    }
  }
  return config;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

export function loadTlsOptions(config: AppConfig): ServerOptions {
  if (!config.tlsCertFile || !config.tlsKeyFile) throw new Error('TLS certificate and key paths are required for HTTPS Manager mode.');
  return {
    cert: fs.readFileSync(config.tlsCertFile, { flag: 'r' }),
    key: fs.readFileSync(config.tlsKeyFile, { flag: 'r' }),
  };
}
