// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';

const HEALTH_SERVICES = {
  integrated: 'gugak-signage',
  manager: 'gugak-signage',
  'player-host': 'gugak-player-host',
};

function loopbackPlayerUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Player Host install requires a valid loopback Player URL.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '43127' ||
      url.pathname !== '/player/' || url.username || url.password || url.search || url.hash) {
    throw new Error('Player Host URL must use http://127.0.0.1:43127/player/ without query or credentials.');
  }
  return url.toString();
}

function playerManagerConnection(config) {
  let url;
  try { url = new URL(String(config.managerUrl || '')); } catch { throw new Error('Player Host install requires a valid Manager URL.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Player Host Manager URL must not contain credentials, path, query, or fragment.');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Player Host remote Manager URL must use HTTPS.');
  }
  const managerCaFile = config.managerCaFile ? path.resolve(String(config.managerCaFile)) : null;
  if (!loopback && !managerCaFile) throw new Error('Player Host remote Manager requires a CA certificate file.');
  if (managerCaFile) {
    let certificate;
    try { certificate = fs.readFileSync(managerCaFile, 'utf8'); } catch { throw new Error('Manager CA certificate file is not readable.'); }
    if (!/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.test(certificate)) {
      throw new Error('Manager CA certificate file must contain a PEM certificate.');
    }
  }
  return { managerUrl: url.toString(), managerCaFile };
}

export function resolveWatchdogRole(config) {
  const role = config.role ?? 'integrated';
  if (!Object.hasOwn(HEALTH_SERVICES, role)) throw new Error('Invalid install role.');
  const defaultPort = role === 'player-host' ? 43127 : config.port;
  if (!Number.isInteger(defaultPort) || defaultPort < 1 || defaultPort > 65535) {
    throw new Error('Invalid install health or entry configuration for role: ' + role);
  }
  const defaults = {
    role,
    serverEntry: role === 'player-host' ? 'player-host-main.js' : 'server.js',
    healthService: HEALTH_SERVICES[role],
    healthPort: defaultPort,
  };
  const serverEntry = config.serverEntry ?? defaults.serverEntry;
  const healthService = config.healthService ?? defaults.healthService;
  const healthPort = config.healthPort ?? defaults.healthPort;
  if (serverEntry !== defaults.serverEntry || healthService !== defaults.healthService || healthPort !== defaults.healthPort) {
    throw new Error('Invalid install health or entry configuration for role: ' + role);
  }
  const playerUrl = role === 'player-host'
    ? loopbackPlayerUrl(config.playerUrl ?? 'http://127.0.0.1:43127/player/')
    : (config.playerUrl ?? `http://127.0.0.1:${config.port}/player/`);
  const managerConnection = role === 'player-host' ? playerManagerConnection(config) : null;
  return {
    ...defaults,
    playerUrl,
    playerAutoStart: role === 'player-host' && config.playerAutoStart !== false,
    ...(managerConnection || {}),
  };
}

export function resolveWatchdogHealthTarget(config, roleConfig = resolveWatchdogRole(config)) {
  if (roleConfig.role !== 'manager' || config.mode !== 'lan') {
    return { url: `http://127.0.0.1:${roleConfig.healthPort}/api/health` };
  }
  if (!config.managerBaseUrl || !config.tlsCertFile) {
    throw new Error('LAN Manager health endpoint requires an HTTPS URL and TLS certificate.');
  }
  let managerUrl;
  try { managerUrl = new URL(String(config.managerBaseUrl)); } catch {
    throw new Error('Invalid LAN Manager health endpoint.');
  }
  const configuredPort = Number(managerUrl.port || 443);
  if (managerUrl.protocol !== 'https:' || managerUrl.username || managerUrl.password ||
      managerUrl.pathname !== '/' || managerUrl.search || managerUrl.hash ||
      configuredPort !== roleConfig.healthPort) {
    throw new Error('LAN Manager health endpoint must use HTTPS and the configured listener port.');
  }
  const caFile = path.resolve(String(config.tlsCertFile));
  let certificate;
  try { certificate = fs.readFileSync(caFile, 'utf8'); } catch {
    throw new Error('LAN Manager health certificate is not readable.');
  }
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.test(certificate)) {
    throw new Error('LAN Manager health certificate must contain a PEM certificate.');
  }
  return {
    url: `https://127.0.0.1:${roleConfig.healthPort}/api/health`,
    servername: managerUrl.hostname,
    caFile,
  };
}
