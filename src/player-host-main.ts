/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { loadLocalEnv } from './env.js';
import { discoverNativeMonitors } from './native-monitors.js';
import { createPlayerCredentialStore, createPlayerIdentityStore } from './player-credentials.js';
import { createPlayerHostServer } from './player-host-server.js';

export function validatePlayerManagerTrust(managerUrl: string, trustBundlePath = process.env.NODE_EXTRA_CA_CERTS, rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED): void {
  let url: URL;
  try { url = new URL(managerUrl); } catch { throw new Error('Invalid GUGAK_MANAGER_URL'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' ||
    url.hostname === '::1' || /^127\./u.test(url.hostname);
  if (rejectUnauthorized === '0') throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed for Player Host connections.');
  if (loopback && url.protocol === 'http:') return;
  if (url.protocol !== 'https:') throw new Error('Player Host remote Manager connections must use HTTPS.');
  if (!loopback && !trustBundlePath) throw new Error('Player Host remote Manager connections require a trusted CA certificate bundle.');
  if (trustBundlePath) {
    let certificate: string;
    try { certificate = fs.readFileSync(path.resolve(trustBundlePath), 'utf8'); } catch {
      throw new Error('Player Host CA certificate bundle is not readable.');
    }
    if (!/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.test(certificate)) {
      throw new Error('Player Host CA certificate bundle must contain a PEM certificate.');
    }
  }
}

export async function startPlayerHost(): Promise<() => Promise<void>> {
  loadLocalEnv();
  const managerUrl = process.env.GUGAK_MANAGER_URL;
  if (!managerUrl) throw new Error('GUGAK_MANAGER_URL is required');
  let parsedManagerUrl: URL;
  try { parsedManagerUrl = new URL(managerUrl); } catch { throw new Error('Invalid GUGAK_MANAGER_URL'); }
  const isLoopback = parsedManagerUrl.hostname === 'localhost' || parsedManagerUrl.hostname === '127.0.0.1' || parsedManagerUrl.hostname === '[::1]' || parsedManagerUrl.hostname === '::1' || /^127\./.test(parsedManagerUrl.hostname);
  if (parsedManagerUrl.protocol !== 'https:' && !(parsedManagerUrl.protocol === 'http:' && isLoopback)) {
    throw new Error('GUGAK_MANAGER_URL must use HTTPS unless it points to loopback HTTP');
  }
  if (parsedManagerUrl.username || parsedManagerUrl.password || parsedManagerUrl.search || parsedManagerUrl.hash || parsedManagerUrl.pathname !== '/') {
    throw new Error('GUGAK_MANAGER_URL must not contain credentials, path, query, or fragment');
  }
  validatePlayerManagerTrust(managerUrl);
  const portValue = process.env.GUGAK_PLAYER_HOST_PORT ?? '43127';
  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error('GUGAK_PLAYER_HOST_PORT must be an integer from 1 through 65535');
  }
  const config = loadConfig();
  const credentialStore = createPlayerCredentialStore({ filePath: path.join(config.dataDir, 'control', 'player-token.dpapi') });
  const identityStore = createPlayerIdentityStore({ filePath: path.join(config.dataDir, 'control', 'player-identity.dpapi') });
  const host = createPlayerHostServer({
    managerUrl,
    credentialStore,
    identityStore,
    assignmentPath: path.join(config.dataDir, 'control', 'screen-targets.json'),
    monitorProvider: () => discoverNativeMonitors(process.platform, config.rootDir),
    host: '127.0.0.1',
    port: Number(portValue),
    rootDir: config.rootDir,
  });
  await host.start();
  return () => host.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void startPlayerHost().then((close) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().then(() => { process.exitCode = 0; }, (error: unknown) => {
        console.error('Player Host shutdown failed', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error: unknown) => {
    console.error('Player Host failed to start', error);
    process.exitCode = 1;
  });
}
