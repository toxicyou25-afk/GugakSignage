// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDemoState } from './demo-data.js';

let saveChain = Promise.resolve();

export async function loadState({ statePath, reset = false, now = Date.now() } = {}) {
  if (!statePath) throw new Error('statePath is required');
  if (!reset) {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.sites)) throw new Error('state file has no sites');
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const state = createDemoState(now);
  await saveState(statePath, state);
  return state;
}

export function saveState(statePath, state) {
  const payload = JSON.stringify(state, null, 2);
  saveChain = saveChain.then(async () => {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temp = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    await fs.rename(temp, statePath);
  });
  return saveChain;
}

export function findSite(state, siteIdOrKey) {
  return state.sites.find((site) => site.id === siteIdOrKey || site.siteKey === siteIdOrKey) ?? null;
}

export function findDisplay(state, displayId) {
  for (const site of state.sites) {
    const display = site.displays.find((candidate) => candidate.id === displayId);
    if (display) return { site, display };
  }
  return null;
}

export function touch(site, nowMs = Date.now()) {
  const stamp = new Date(nowMs).toISOString();
  site.updatedAt = stamp;
  if (site.publication) {
    site.publication.version = (site.publication.version ?? 0) + 1;
    site.publication.publishedAt = stamp;
    site.publication.publishedBy = 'poc-server';
  }
}
