// SPDX-License-Identifier: Apache-2.0
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  assignDisplays,
  buildLayout,
  manifestForDisplay,
  reflowLayout,
} from '../../packages/engine/index.js';
import { DEMO_IMAGE_SETS } from './demo-media.js';
import { createDemoState, demoMediaCatalog } from './demo-data.js';
import { findDisplay, findSite, loadState, saveState, touch } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const POC_ROOT = path.resolve(here, '../..');
const DEFAULT_STATE_PATH = path.join(here, 'data', 'state.json');
const MEDIA_ROOT = path.join(POC_ROOT, 'media');
const ENGINE_ROOT = path.join(POC_ROOT, 'packages', 'engine');
const SHARED_ROOT = path.join(POC_ROOT, 'apps', 'shared');
const PLAYER_ROOT = path.join(POC_ROOT, 'apps', 'player-web');
const PREVIEW_ROOT = path.join(POC_ROOT, 'apps', 'preview');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, value, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    ...headers,
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  res.end(text);
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function publicSite(site, nowMs = Date.now()) {
  const copy = JSON.parse(JSON.stringify(site));
  copy.displays = copy.displays.map((display) => {
    const lastSeenMs = display.lastSeen ? Date.parse(display.lastSeen) : 0;
    const stale = !Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > 90_000;
    return {
      ...display,
      status: display.status === 'offline' || stale ? 'offline' : 'online',
    };
  });
  return copy;
}

function siteSummary(site, nowMs, baseUrl) {
  const group = site.groups[0] ?? null;
  const playlist = group ? site.playlists.find((candidate) => candidate.id === group.playlistId) : null;
  const firstDisplay = site.displays[0] ?? null;
  const publicCopy = publicSite(site, nowMs);
  return {
    id: site.id,
    name: site.name,
    timezone: site.timezone,
    notes: site.notes ?? null,
    siteKey: site.siteKey ?? null,
    groupId: group?.id ?? null,
    mode: group?.playbackMode ?? null,
    displayCount: site.displays.length,
    onlineCount: publicCopy.displays.filter((display) => display.status === 'online').length,
    imageCount: playlist?.items?.length ?? 0,
    version: site.publication?.version ?? 1,
    previewUrl: `/preview/?site=${encodeURIComponent(site.id)}`,
    playerUrls: site.displays.map((display) => ({
      displayId: display.id,
      name: display.name,
      url: `/player/?site=${encodeURIComponent(site.id)}&display=${encodeURIComponent(display.id)}`,
    })),
    firstDisplayId: firstDisplay?.id ?? null,
    demo: Boolean(baseUrl),
  };
}

function siteIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/sites\/([^/]+)(?:\/manifest)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleManifest(res, state, site, displayId, nowMs) {
  const publicCopy = publicSite(site, nowMs);
  let chosenDisplayId = displayId;
  if (!chosenDisplayId) {
    if (site.displays.length === 0) {
      sendJson(res, 404, { error: 'NO_DISPLAYS', message: `Site ${site.id} has no displays.` });
      return;
    }
    chosenDisplayId = site.displays[0].id;
  }
  const display = site.displays.find((candidate) => candidate.id === chosenDisplayId);
  if (!display) {
    sendJson(res, 404, { error: 'DISPLAY_NOT_FOUND', message: `Display ${chosenDisplayId} is not in site ${site.id}.` });
    return;
  }
  if (display.status !== 'online' || publicCopy.displays.find((candidate) => candidate.id === display.id)?.status === 'offline') {
    const updated = publicCopy.displays.find((candidate) => candidate.id === display.id);
    if (updated) updated.status = 'offline';
  }
  const manifest = manifestForDisplay(publicCopy, chosenDisplayId, { now: nowMs });
  manifest.serverTime = nowMs;
  manifest.etag = `"site-${site.id}-v${manifest.version}-${chosenDisplayId}"`;
  manifest.noCache = true;
  sendJson(res, 200, manifest, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
}

function deriveNewDisplay({ site, group, hardwareId, body, nowMs }) {
  const layout = site.layouts.find((candidate) => candidate.id === group.layoutId);
  if (!layout) throw new Error('Group layout missing');
  const displays = site.displays.filter((display) => display.groupId === group.id);
  let nextLayout = layout;
  let slotId;
  if (layout.type === 'custom') {
    const assignment = assignDisplays(layout, displays);
    if (assignment.emptySlots.length === 0) {
      const error = new Error('Custom layout has no empty slot; add a slot in the admin plan first.');
      error.statusCode = 409;
      throw error;
    }
    slotId = assignment.emptySlots[0].id;
  } else if (layout.type === 'single') {
    nextLayout = buildLayout({
      id: layout.id,
      name: '자동 가로 2면',
      type: 'row',
      displayCount: 2,
      gap: 0.01,
    });
    slotId = nextLayout.slots[1].id;
  } else {
    nextLayout = reflowLayout(layout, displays.length + 1, { gap: layout.gap });
    slotId = nextLayout.slots[displays.length].id;
  }
  const width = Number.isInteger(body.resolution?.width) && body.resolution.width > 0 ? body.resolution.width : 1920;
  const height = Number.isInteger(body.resolution?.height) && body.resolution.height > 0 ? body.resolution.height : 1080;
  const orientation = body.orientation === 'portrait' ? 'portrait' : width < height ? 'portrait' : 'landscape';
  const idBase = hardwareId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toLowerCase() || crypto.randomBytes(3).toString('hex');
  let id = `disp-auto-${idBase}`;
  while (site.displays.some((display) => display.id === id)) id = `${id}-${crypto.randomBytes(1).toString('hex')}`;
  const display = {
    id,
    groupId: group.id,
    name: `자동 등록 ${site.displays.length + 1}`,
    slotId,
    hardwareId,
    resolution: { width, height },
    orientation,
    rotation: [0, 90, 180, 270].includes(body.rotation) ? body.rotation : 0,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 20) : ['browser'],
    status: 'online',
    lastSeen: new Date(nowMs).toISOString(),
    pairingState: 'auto',
    startIndex: site.displays.length,
    step: 1,
    fit: undefined,
  };
  return { display, layout: nextLayout };
}

async function handleRegister(req, res, state, statePath) {
  const body = await readJson(req);
  const site = findSite(state, body.siteKey ?? body.siteId);
  if (!site) {
    sendJson(res, 404, { error: 'SITE_NOT_FOUND', message: 'Use a valid siteKey or siteId.' });
    return;
  }
  const nowMs = Date.now();
  if (body.displayId) {
    const found = findDisplay(state, body.displayId);
    if (!found || found.site.id !== site.id) {
      sendJson(res, 404, { error: 'DISPLAY_NOT_FOUND', message: `Display ${body.displayId} is not in site ${site.id}.` });
      return;
    }
    if (body.hardwareId) found.display.hardwareId = String(body.hardwareId).slice(0, 160);
    found.display.status = 'online';
    found.display.lastSeen = new Date(nowMs).toISOString();
    found.display.runtime = {
      ...(found.display.runtime ?? {}),
      userAgent: String(body.userAgent ?? '').slice(0, 300),
      viewport: body.resolution ?? null,
    };
    await saveState(statePath, state);
    sendJson(res, 200, {
      paired: true,
      displayId: found.display.id,
      siteId: site.id,
      groupId: found.display.groupId,
      name: found.display.name,
      serverTime: nowMs,
      manifestUrl: `/api/sites/${encodeURIComponent(site.id)}/manifest?displayId=${encodeURIComponent(found.display.id)}`,
      playerUrl: `/player/?site=${encodeURIComponent(site.id)}&display=${encodeURIComponent(found.display.id)}`,
    });
    return;
  }
  if (!body.hardwareId || typeof body.hardwareId !== 'string') {
    sendJson(res, 400, { error: 'HARDWARE_ID_REQUIRED', message: 'Auto registration needs a hardwareId or a displayId link.' });
    return;
  }
  const existing = site.displays.find((display) => display.hardwareId === body.hardwareId);
  if (existing) {
    existing.status = 'online';
    existing.lastSeen = new Date(nowMs).toISOString();
    await saveState(statePath, state);
    sendJson(res, 200, {
      paired: true,
      existing: true,
      displayId: existing.id,
      siteId: site.id,
      groupId: existing.groupId,
      name: existing.name,
      serverTime: nowMs,
      manifestUrl: `/api/sites/${encodeURIComponent(site.id)}/manifest?displayId=${encodeURIComponent(existing.id)}`,
    });
    return;
  }
  const group = site.groups.find((candidate) => candidate.id === body.groupId) ?? site.groups[0];
  if (!group) {
    sendJson(res, 409, { error: 'NO_GROUP', message: 'Site has no display group.' });
    return;
  }
  const { display, layout } = deriveNewDisplay({ site, group, hardwareId: body.hardwareId, body, nowMs });
  site.layouts = site.layouts.map((candidate) => (candidate.id === layout.id ? layout : candidate));
  group.layoutId = layout.id;
  site.displays.push(display);
  touch(site, nowMs);
  await saveState(statePath, state);
  sendJson(res, 201, {
    paired: true,
    created: true,
    displayId: display.id,
    siteId: site.id,
    groupId: group.id,
    name: display.name,
    slotId: display.slotId,
    serverTime: nowMs,
    manifestUrl: `/api/sites/${encodeURIComponent(site.id)}/manifest?displayId=${encodeURIComponent(display.id)}`,
    playerUrl: `/player/?site=${encodeURIComponent(site.id)}&display=${encodeURIComponent(display.id)}`,
  });
}

async function handleHeartbeat(req, res, state, statePath, displayId) {
  const found = findDisplay(state, displayId);
  if (!found) {
    sendJson(res, 404, { error: 'DISPLAY_NOT_FOUND', message: `Display ${displayId} does not exist.` });
    return;
  }
  const body = await readJson(req);
  const nowMs = Date.now();
  found.display.status = 'online';
  found.display.lastSeen = new Date(nowMs).toISOString();
  found.display.runtime = {
    ...(found.display.runtime ?? {}),
    reportedAt: new Date(nowMs).toISOString(),
    clientTime: Number.isFinite(body.clientTime) ? body.clientTime : null,
    imageId: typeof body.imageId === 'string' ? body.imageId.slice(0, 120) : null,
    imageIndex: Number.isInteger(body.imageIndex) ? body.imageIndex : null,
    slot: Number.isInteger(body.slot) ? body.slot : null,
    mode: typeof body.mode === 'string' ? body.mode.slice(0, 40) : null,
    fit: typeof body.fit === 'string' ? body.fit.slice(0, 20) : null,
    offline: Boolean(body.offline),
  };
  await saveState(statePath, state);
  sendJson(res, 200, {
    ok: true,
    displayId,
    siteId: found.site.id,
    status: 'online',
    serverTime: nowMs,
    version: found.site.publication?.version ?? 1,
    nextHeartbeatMs: 30_000,
  });
}

async function handleDeleteDisplay(res, state, statePath, displayId) {
  const found = findDisplay(state, displayId);
  if (!found) {
    sendJson(res, 404, { error: 'DISPLAY_NOT_FOUND', message: `Display ${displayId} does not exist.` });
    return;
  }
  const { site, display } = found;
  const group = site.groups.find((candidate) => candidate.id === display.groupId);
  site.displays = site.displays.filter((candidate) => candidate.id !== displayId);
  const remaining = site.displays.filter((candidate) => candidate.groupId === group?.id);
  if (group) {
    const layout = site.layouts.find((candidate) => candidate.id === group.layoutId);
    if (layout && layout.type !== 'custom' && remaining.length > 0) {
      const refreshed = reflowLayout(layout, remaining.length, { gap: layout.gap });
      site.layouts = site.layouts.map((candidate) => (candidate.id === refreshed.id ? refreshed : candidate));
      const assignment = assignDisplays(refreshed, remaining);
      for (const item of remaining) item.slotId = assignment.byDisplay.get(item.id)?.id ?? item.slotId;
    }
  }
  touch(site, Date.now());
  await saveState(statePath, state);
  sendJson(res, 200, {
    ok: true,
    removed: displayId,
    siteId: site.id,
    displayCount: site.displays.length,
    layoutType: group ? site.layouts.find((candidate) => candidate.id === group.layoutId)?.type : null,
  });
}

function handleDemo(res) {
  sendJson(res, 200, {
    imageSets: DEMO_IMAGE_SETS,
    images: demoMediaCatalog(),
    presets: [
      { displayCount: 1, layoutType: 'single', label: '1 display' },
      { displayCount: 4, layoutType: 'row', label: '4 displays in a row' },
      { displayCount: 8, layoutType: 'grid', label: '8 displays in a grid' },
    ],
    modes: ['individual', 'synchronized-cycle', 'mirror', 'canvas'],
  });
}

function handleSites(res, state, nowMs) {
  sendJson(
    res,
    200,
    state.sites.map((site) => siteSummary(site, nowMs, true)),
  );
}

async function serveStatic(res, root, relativePath, req) {
  const decoded = decodeURIComponent(relativePath);
  const target = path.resolve(root, decoded || 'index.html');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  let file = target;
  if (stat.isDirectory()) file = path.join(target, 'index.html');
  try {
    const body = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    securityHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': file.startsWith(MEDIA_ROOT) ? 'public, max-age=3600' : 'no-cache',
      ...(file.endsWith('sw.js') ? { 'Service-Worker-Allowed': '/player/' } : {}),
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function route(req, res, state, statePath, nowMs) {
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET,HEAD,POST,DELETE,OPTIONS' });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, now: nowMs, sites: state.sites.length });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/time') {
    sendJson(res, 200, {
      now: nowMs,
      serverTime: nowMs,
      iso: new Date(nowMs).toISOString(),
      timezone: 'Asia/Seoul',
    }, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/sites') {
    handleSites(res, state, nowMs);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/demo') {
    handleDemo(res);
    return;
  }
  const sitePathId = siteIdFromPath(pathname);
  if (req.method === 'GET' && sitePathId && pathname.endsWith('/manifest')) {
    const site = findSite(state, sitePathId);
    if (!site) {
      sendJson(res, 404, { error: 'SITE_NOT_FOUND', message: `Site ${sitePathId} does not exist.` });
      return;
    }
    await handleManifest(res, state, site, url.searchParams.get('displayId'), nowMs);
    return;
  }
  if (req.method === 'GET' && sitePathId) {
    const site = findSite(state, sitePathId);
    if (!site) {
      sendJson(res, 404, { error: 'SITE_NOT_FOUND', message: `Site ${sitePathId} does not exist.` });
      return;
    }
    const publicCopy = publicSite(site, nowMs);
    const groups = publicCopy.groups.map((group) => {
      const playlist = publicCopy.playlists.find((candidate) => candidate.id === group.playlistId);
      return {
        ...group,
        displayCount: publicCopy.displays.filter((display) => display.groupId === group.id).length,
        imageCount: playlist?.items?.length ?? 0,
      };
    });
    sendJson(res, 200, {
      ...publicCopy,
      groups,
      demo: {
        playerUrls: site.displays.map((display) => ({
          displayId: display.id,
          name: display.name,
          url: `/player/?site=${encodeURIComponent(site.id)}&display=${encodeURIComponent(display.id)}`,
        })),
      },
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/displays/register') {
    await handleRegister(req, res, state, statePath);
    return;
  }
  const heartbeatMatch = pathname.match(/^\/api\/displays\/([^/]+)\/heartbeat$/);
  if (req.method === 'POST' && heartbeatMatch) {
    await handleHeartbeat(req, res, state, statePath, decodeURIComponent(heartbeatMatch[1]));
    return;
  }
  const deleteMatch = pathname.match(/^\/api\/displays\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    await handleDeleteDisplay(res, state, statePath, decodeURIComponent(deleteMatch[1]));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/admin/reset') {
    const fresh = createDemoState(Date.now());
    state.sites = fresh.sites;
    state.epoch = fresh.epoch;
    state.seededAt = fresh.seededAt;
    state.updatedAt = fresh.updatedAt;
    await saveState(statePath, state);
    sendJson(res, 200, { ok: true, reset: true, sites: state.sites.length, epoch: state.epoch });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/' || pathname === '/preview' || pathname === '/admin') {
      res.writeHead(302, { Location: '/preview/' });
      res.end();
      return;
    }
    if (pathname === '/player') {
      res.writeHead(302, { Location: '/player/' });
      res.end();
      return;
    }
    const staticRoutes = [
      ['/preview/', PREVIEW_ROOT],
      ['/player/', PLAYER_ROOT],
      ['/shared/', SHARED_ROOT],
      ['/engine/', ENGINE_ROOT],
      ['/media/', MEDIA_ROOT],
    ];
    for (const [prefix, root] of staticRoutes) {
      if (pathname.startsWith(prefix)) {
        await serveStatic(res, root, pathname.slice(prefix.length), req);
        return;
      }
    }
  }
  sendJson(res, 404, { error: 'NOT_FOUND', message: `${req.method} ${pathname}` });
}

export async function startServer({
  port = 4173,
  host = '127.0.0.1',
  statePath = DEFAULT_STATE_PATH,
  reset = false,
  quiet = false,
} = {}) {
  const resolvedStatePath = path.resolve(statePath);
  const state = await loadState({ statePath: resolvedStatePath, reset });
  const server = http.createServer((req, res) => {
    route(req, res, state, resolvedStatePath, Date.now()).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, error.statusCode ?? 500, {
          error: error.statusCode ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
          message: error.message,
        });
      } else {
        res.end();
      }
      if (!quiet) console.error(error);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  if (!quiet) {
    console.log(`GugakSignage PoC server: ${url}`);
    console.log(`Preview: ${url}/preview/`);
    for (const site of state.sites) {
      const first = site.displays[0];
      console.log(`  ${site.id} (key ${site.siteKey}) ${site.displays.length} display(s): ${url}/player/?site=${site.id}${first ? `&display=${first.id}` : ''}`);
    }
    console.log(`State: ${resolvedStatePath}`);
  }
  return {
    server,
    state,
    statePath: resolvedStatePath,
    port: actualPort,
    url,
    close: () => new Promise((resolve, reject) => {
      server.closeIdleConnections?.();
      const force = setTimeout(() => server.closeAllConnections?.(), 750);
      force.unref?.();
      server.close((error) => {
        clearTimeout(force);
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

function parseArgs(argv) {
  const args = { port: 4173, host: '127.0.0.1', statePath: DEFAULT_STATE_PATH, reset: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') args.port = Number(argv[++index]);
    else if (arg === '--host') args.host = argv[++index];
    else if (arg === '--state') args.statePath = argv[++index];
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node apps/server/server.js [--port 4173] [--host 127.0.0.1] [--state path] [--reset]');
    process.exit(0);
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    console.error('Invalid --port');
    process.exit(1);
  }
  startServer(args).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
