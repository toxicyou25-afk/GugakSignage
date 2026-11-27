/* SPDX-License-Identifier: Apache-2.0 */
import path from 'node:path';
import express from 'express';
import type { AddressInfo, Server } from 'node:net';
import type { NativeMonitorResult } from './native-monitors.js';
import type { PlayerCredentialStore, PlayerIdentityStore } from './player-credentials.js';
import { createPlayerHostApp } from './player-host.js';

export interface PlayerHostServerOptions {
  managerUrl: string;
  credentialStore: PlayerCredentialStore;
  identityStore: PlayerIdentityStore;
  monitorProvider?: () => Promise<NativeMonitorResult>;
  assignmentPath?: string;
  host?: string;
  port?: number;
  rootDir?: string;
}

export interface PlayerHostServer {
  readonly app: express.Express;
  readonly server: Server;
  readonly port: number;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createPlayerHostServer(options: PlayerHostServerOptions): PlayerHostServer {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('Player Host must bind exactly to 127.0.0.1');
  const rootDir = options.rootDir ?? process.cwd();
  const app = createPlayerHostApp(options);
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'gugak-player-host' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self' http: https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    next();
  });
  const playerRoot = path.join(rootDir, 'public', 'player');
  app.get('/', (_req, res) => res.redirect(302, '/player/'));
  app.use('/player', express.static(playerRoot, { index: 'index.html', fallthrough: false }));
  app.use('/engine', express.static(path.join(rootDir, 'poc', 'packages', 'engine'), { index: false, fallthrough: false }));
  const server = app.listen(options.port ?? 0, host);
  let listening = false;
  return {
    app,
    server,
    get port() {
      const address = server.address() as AddressInfo | null;
      return address?.port ?? (options.port ?? 0);
    },
    start() {
      if (listening) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { listening = true; server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) { resolve(); return; }
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
