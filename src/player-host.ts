/* SPDX-License-Identifier: Apache-2.0 */
import { isIP } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response } from 'express';
import type { NativeMonitorResult } from './native-monitors.js';
import type { PlayerCredentialStore, PlayerIdentityStore } from './player-credentials.js';

export interface PlayerHostOptions {
  managerUrl: string;
  credentialStore: PlayerCredentialStore;
  identityStore: PlayerIdentityStore;
  monitorProvider?: () => Promise<NativeMonitorResult>;
  fetchImpl?: typeof fetch;
  assignmentPath?: string;
}

function managerBase(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid Manager URL'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' ||
    (isIP(url.hostname) === 4 && Number(url.hostname.split('.')[0]) === 127);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Manager URL must be HTTPS, or loopback HTTP, without credentials, path, query, or fragment');
  }
  return url;
}

function allowedHost(host: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) &&
    (() => {
      const port = host.match(/:(\d+)$/)?.[1];
      return !port || Number(port) <= 65535;
    })();
}

function sameOriginRequest(req: Request): boolean {
  const host = req.get('host') ?? '';
  if (!allowedHost(host)) return false;
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const scheme = req.secure ? 'https:' : 'http:';
    return parsed.protocol === scheme && parsed.host === new URL(`${scheme}//${host}`).host;
  } catch { return false; }
}

const passthroughHeaders = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'content-range', 'accept-ranges'];

export function createPlayerHostApp(options: PlayerHostOptions) {
  const base = managerBase(options.managerUrl);
  const fetcher = options.fetchImpl ?? fetch;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    if (!sameOriginRequest(req)) { res.status(403).json({ error: 'Forbidden host or origin' }); return; }
    next();
  });

  async function proxy(req: Request, res: Response, upstreamPath: string, authenticated: boolean, body?: string, persistedRegistrationToken?: string): Promise<void> {
    let token: string | null = null;
    if (authenticated) {
      try { token = await options.credentialStore.readToken(); } catch {
        res.status(503).json({ error: 'Player credential storage is unavailable' });
        return;
      }
      if (!token) { res.status(401).json({ error: 'Player is not registered' }); return; }
    }
    const headers = new Headers();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const contentType = req.get('content-type');
    if (body !== undefined && contentType) headers.set('content-type', contentType);
    const range = req.get('range');
    if (upstreamPath.startsWith('/media/') && range) headers.set('range', range);
    const abortController = upstreamPath.startsWith('/media/') ? new AbortController() : null;
    const abortUpstream = () => abortController?.abort();
    if (abortController) {
      req.once('aborted', abortUpstream);
      res.once('close', abortUpstream);
    }
    try {
      const target = new URL(upstreamPath, base);
      const upstream = await fetcher(target, { method: req.method, headers, body, redirect: 'error', ...(abortController ? { signal: abortController.signal } : {}) });
      if (upstream.status === 401 && authenticated && token) {
        if (options.credentialStore.clearIfToken) await options.credentialStore.clearIfToken(token);
        else if (await options.credentialStore.readToken() === token) await options.credentialStore.clear();
      }
      for (const name of passthroughHeaders) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      res.status(upstream.status);
      if (upstreamPath === '/api/player/config') {
        res.removeHeader('content-length');
        const text = await upstream.text();
        try {
          const data: unknown = JSON.parse(text);
          res.json(data && typeof data === 'object' && !Array.isArray(data)
            ? { ...data, hostManaged: true, adminDevicesUrl: new URL('/admin/#/devices', base).toString() }
            : { value: data, hostManaged: true });
        } catch { res.type('text/plain').send(text); }
        return;
      }
      if (upstreamPath === '/api/player/manifest') {
        const text = await upstream.text();
        if (upstream.ok && token) await refreshScreenTargets(token);
        res.removeHeader('content-length');
        res.send(text);
        return;
      }
      if (upstreamPath === '/api/player/register') {
        const text = await upstream.text();
        if (upstream.ok) {
          res.removeHeader('content-length');
          let data: Record<string, unknown>;
          try { data = JSON.parse(text) as Record<string, unknown>; } catch { res.status(502).json({ error: 'Invalid Manager registration response' }); return; }
          const receivedToken = data.token;
          if (typeof receivedToken !== 'string' || !/^[a-f0-9]{64}$/.test(receivedToken)) {
            res.status(502).json({ error: 'Invalid Manager registration response' }); return;
          }
          if (receivedToken !== persistedRegistrationToken) await options.credentialStore.writeToken(receivedToken);
          await reportNativeMonitors();
          await refreshScreenTargets(receivedToken);
          const { token: _secret, ...rendererBody } = data;
          res.json(rendererBody);
          return;
        }
        res.send(text);
        return;
      }
      if (!upstream.body) { res.end(); return; }
      await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res, abortController ? { signal: abortController.signal } : {});
    } catch {
      if (upstreamPath === '/api/player/register') res.destroy();
      else if (!res.headersSent) res.status(502).json({ error: 'Manager request failed' });
      else if (!res.destroyed) res.destroy();
    } finally {
      if (abortController) {
        req.off('aborted', abortUpstream);
        res.off('close', abortUpstream);
      }
    }
  }

  let lastMonitorReportAt = 0;
  let monitorReportInFlight: Promise<void> | null = null;
  async function reportNativeMonitors(): Promise<void> {
    if (!options.monitorProvider || Date.now() - lastMonitorReportAt < 15_000) return;
    if (monitorReportInFlight) return monitorReportInFlight;
    monitorReportInFlight = (async () => {
      const token = await options.credentialStore.readToken();
      if (!token) return;
      const snapshot = await options.monitorProvider!();
      if (!snapshot.supported || snapshot.error || snapshot.monitors.length > 32) return;
      const response = await fetcher(new URL('/api/player/native-monitors', base), {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ monitors: snapshot.monitors }),
        redirect: 'error',
      });
      if (response.status === 401) {
        if (options.credentialStore.clearIfToken) await options.credentialStore.clearIfToken(token);
        else if (await options.credentialStore.readToken() === token) await options.credentialStore.clear();
      }
      await response.text();
      if (response.ok) lastMonitorReportAt = Date.now();
    })().catch(() => {}).finally(() => { monitorReportInFlight = null; });
    await monitorReportInFlight;
  }

  async function refreshScreenTargets(token?: string): Promise<void> {
    if (!options.assignmentPath) return;
    try {
      const credential = token ?? await options.credentialStore.readToken();
      if (!credential) return;
      const response = await fetcher(new URL('/api/player/screen-targets', base), {
        headers: { authorization: `Bearer ${credential}` },
        redirect: 'error',
      });
      if (response.status === 401) {
        if (options.credentialStore.clearIfToken) await options.credentialStore.clearIfToken(credential);
        else if (await options.credentialStore.readToken() === credential) await options.credentialStore.clear();
        return;
      }
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const data = value as Record<string, unknown>;
      if (typeof data.deviceId !== 'string' || !data.deviceId || !Array.isArray(data.screenTargets) || data.screenTargets.length > 32) return;
      const seenDisplays = new Set<string>();
      const seenMonitors = new Set<string>();
      const screenTargets = [];
      for (const raw of data.screenTargets) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const target = raw as Record<string, unknown>;
        const displayId = typeof target.displayId === 'string' ? target.displayId.trim() : '';
        const nativeMonitorId = typeof target.nativeMonitorId === 'string' ? target.nativeMonitorId.trim() : '';
        if (!displayId || displayId.length > 100 || !nativeMonitorId || nativeMonitorId.length > 512 ||
            !/^MONITOR\\/iu.test(nativeMonitorId) || seenDisplays.has(displayId) || seenMonitors.has(nativeMonitorId)) return;
        seenDisplays.add(displayId);
        seenMonitors.add(nativeMonitorId);
        screenTargets.push({ displayId, nativeMonitorId });
      }
      const filePath = path.resolve(options.assignmentPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
      fs.writeFileSync(temporary, `${JSON.stringify({ deviceId: data.deviceId, screenTargets })}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, filePath);
    } catch {
      // Keep the last complete assignment snapshot when Manager is unreachable or storage fails.
    }
  }

  type RegistrationResult = { status: number; body: string; json: boolean };
  const registrationsInFlight = new Map<string, Promise<RegistrationResult>>();
  let registrationQueue: Promise<void> = Promise.resolve();
  app.post('/api/player/register', (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
    const key = rawCode ? rawCode.toUpperCase() : JSON.stringify(body);
    let registration = registrationsInFlight.get(key);
    if (!registration) {
      registration = registrationQueue.then(async (): Promise<RegistrationResult> => {
        const [hardwareId, persistedRetry] = await Promise.all([
          options.identityStore.getOrCreateHardwareId(),
          options.credentialStore.readRegistrationRetry?.() ?? Promise.resolve(null),
        ]);
        const code = rawCode || null;
        const identity = code === null ? null : createHash('sha256').update(code.toUpperCase()).digest('hex');
        const retryPrefix = identity === null ? null : `${identity}.`;
        const retryToken = retryPrefix && persistedRetry?.startsWith(retryPrefix)
          ? persistedRetry.slice(retryPrefix.length) : '';
        const playerToken = /^[a-f0-9]{64}$/.test(retryToken)
          ? retryToken : randomBytes(32).toString('hex');
        if (identity !== null && !options.credentialStore.writeRegistrationRetry) {
          return { status: 503, body: JSON.stringify({ error: 'Player credential storage is unavailable' }), json: true };
        }
        if (identity !== null && playerToken !== retryToken) {
          await options.credentialStore.writeRegistrationRetry!(`${identity}.${playerToken}`);
        }

        let upstream: globalThis.Response;
        try {
          upstream = await fetcher(new URL('/api/player/register', base), {
            method: req.method,
            headers: { 'content-type': req.get('content-type') ?? 'application/json' },
            body: JSON.stringify({ ...body, hardwareId, playerToken }),
            redirect: 'error',
          });
        } catch {
          return { status: 502, body: JSON.stringify({ error: 'Manager request failed' }), json: true };
        }
        const text = await upstream.text();
        if (!upstream.ok) {
          return { status: upstream.status, body: text, json: false };
        }
        let data: Record<string, unknown>;
        try { data = JSON.parse(text) as Record<string, unknown>; }
        catch { return { status: 502, body: JSON.stringify({ error: 'Invalid Manager registration response' }), json: true }; }
        const acceptedToken = data.token;
        if (typeof acceptedToken !== 'string' || !/^[a-f0-9]{64}$/.test(acceptedToken)) {
          return { status: 502, body: JSON.stringify({ error: 'Invalid Manager registration response' }), json: true };
        }
        try {
          await options.credentialStore.writeToken(acceptedToken);
          if (identity !== null && acceptedToken !== playerToken) {
            await options.credentialStore.writeRegistrationRetry!(`${identity}.${acceptedToken}`);
          }
        } catch {
          return { status: 503, body: JSON.stringify({ error: 'Player credential storage is unavailable' }), json: true };
        }
        await reportNativeMonitors();
        await refreshScreenTargets(acceptedToken);
        const { token: _secret, ...rendererBody } = data;
        return { status: upstream.status, body: JSON.stringify(rendererBody), json: true };
      }).catch(() => ({ status: 503, body: JSON.stringify({ error: 'Player identity or credential storage is unavailable' }), json: true }));
      registrationsInFlight.set(key, registration);
      registrationQueue = registration.then(() => undefined, () => undefined);
      void registration.finally(() => {
        if (registrationsInFlight.get(key) === registration) registrationsInFlight.delete(key);
      });
    }
    void registration.then((result) => {
      res.status(result.status);
      if (result.json) res.json(JSON.parse(result.body));
      else res.send(result.body);
    });
  });
  app.get('/api/player/config', async (_req, res) => {
    const fallback = {
      hostManaged: true,
      adminDevicesUrl: new URL('/admin/#/devices', base).toString(),
      sampleMode: false,
      sampleCode: null,
    };
    res.setHeader('Cache-Control', 'no-store');
    try {
      const upstream = await fetcher(new URL('/api/player/config', base), { redirect: 'error' });
      if (!upstream.ok) { res.json(fallback); return; }
      const data: unknown = await upstream.json();
      res.json(data && typeof data === 'object' && !Array.isArray(data)
        ? { ...fallback, ...data, hostManaged: true, adminDevicesUrl: fallback.adminDevicesUrl }
        : fallback);
    } catch {
      res.json(fallback);
    }
  });
  app.get('/api/player/manifest', (req, res) => { void proxy(req, res, '/api/player/manifest', true); });
  app.post('/api/player/heartbeat', (req, res) => {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) void reportNativeMonitors().then(() => refreshScreenTargets());
    });
    void proxy(req, res, '/api/player/heartbeat', true, JSON.stringify(req.body ?? {}));
  });
  app.get('/api/player/time', (req, res) => { void proxy(req, res, '/api/time', true); });
  app.get('/api/time', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    void proxy(req, res, '/api/time', false);
  });
  app.post('/api/player/disconnect', async (_req, res) => {
    try {
      await options.credentialStore.clear();
      res.status(204).end();
    } catch {
      res.status(503).json({ error: 'Player credential storage is unavailable' });
    }
  });
  app.get('/media/*', (req, res) => {
    const rawPath = (req.originalUrl.split('?', 1)[0] ?? '').slice('/media/'.length);
    let valid = rawPath.length > 0;
    for (const segment of rawPath.split('/')) {
      let decoded: string;
      try { decoded = decodeURIComponent(segment); } catch { valid = false; break; }
      let stable = false;
      for (let pass = 0; pass < 16; pass += 1) {
        if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /[\x00-\x1f]/.test(decoded)) {
          valid = false; break;
        }
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) { stable = true; break; }
          decoded = next;
        } catch {
          stable = true;
          break;
        }
      }
      if (!stable) valid = false;
      if (!valid || !decoded) { valid = false; break; }
    }
    if (!valid) { res.status(400).json({ error: 'Invalid media path' }); return; }
    const query = req.originalUrl.includes('?') ? `?${req.originalUrl.split('?').slice(1).join('?')}` : '';
    void proxy(req, res, `/media/${rawPath}${query}`, true);
  });

  return app;
}
