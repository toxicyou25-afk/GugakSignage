// SPDX-License-Identifier: Apache-2.0
import { patternPreview } from './patterns.js';
import { resolveDwell, resolveMode } from './timeline.js';
import { summarizeIssues, validateSite, validateSnapshot } from './validation.js';

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function createSnapshot({
  site,
  group,
  layout,
  playlist,
  displays,
  images,
  mode,
  epoch,
  epochMs,
  dwellMs,
  settings,
} = {}) {
  const effectiveMode = mode ?? group?.playbackMode;
  const effectiveEpoch = epochMs ?? (typeof epoch === 'number' ? epoch : group?.epoch ?? site?.publication?.epoch);
  const epochValue = typeof effectiveEpoch === 'number' ? effectiveEpoch : Date.parse(effectiveEpoch);
  return {
    site,
    group,
    layout,
    playlist,
    displays: displays ?? (site?.displays ?? []).filter((display) => display.groupId === group?.id),
    images: images ?? (site?.images ?? []),
    mode: effectiveMode,
    epoch: isoOrNull(epochValue),
    epochMs: Number.isFinite(epochValue) ? epochValue : undefined,
    dwellMs: dwellMs ?? group?.settings?.dwellMs,
    settings: { ...(group?.settings ?? {}), ...(settings ?? {}) },
  };
}

export function groupSnapshot(site, groupId, options = {}) {
  const group = (site.groups ?? []).find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const layout = (site.layouts ?? []).find((candidate) => candidate.id === group.layoutId);
  const playlist = (site.playlists ?? []).find((candidate) => candidate.id === group.playlistId);
  if (!layout) throw new Error(`Group ${groupId} references missing layout ${group.layoutId}`);
  if (!playlist) throw new Error(`Group ${groupId} references missing playlist ${group.playlistId}`);
  const displays = (site.displays ?? [])
    .filter((display) => display.groupId === groupId)
    .filter((display) => !options.displayIds || options.displayIds.includes(display.id));
  const selectedItems = options.playlistItems ?? playlist.items;
  const effectivePlaylist = { ...playlist, items: selectedItems };
  const imageIds = new Set(selectedItems.map((item) => item.imageId));
  const images = (site.images ?? []).filter((image) => imageIds.has(image.id));
  return createSnapshot({
    site,
    group,
    layout: options.layout ?? layout,
    playlist: effectivePlaylist,
    displays: options.displays ?? displays,
    images: options.images ?? images,
    mode: options.mode,
    epoch: options.epoch,
    dwellMs: options.dwellMs,
    settings: options.settings,
  });
}

export function displaySnapshot(site, displayId, options = {}) {
  const display = (site.displays ?? []).find((candidate) => candidate.id === displayId);
  if (!display) throw new Error(`Unknown display ${displayId}`);
  return groupSnapshot(site, display.groupId, options);
}

export function manifestForDisplay(site, displayId, options = {}) {
  const siteIssues = validateSite(site);
  const display = (site.displays ?? []).find((candidate) => candidate.id === displayId);
  if (!display) throw new Error(`Unknown display ${displayId}`);
  const snapshot = displaySnapshot(site, displayId, options);
  const issues = [...siteIssues, ...validateSnapshot(snapshot)];
  const mode = resolveMode(snapshot);
  const { dwellMs, source: dwellSource } = resolveDwell(snapshot);
  const pattern = options.includePattern === false ? null : patternPreview(snapshot, { maxSlots: options.maxPatternSlots ?? 120 });
  return {
    schemaVersion: 1,
    version: site.publication?.version ?? 1,
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    serverTime: options.now ?? Date.now(),
    site: {
      id: site.id,
      name: site.name,
      timezone: site.timezone,
      notes: site.notes ?? null,
    },
    group: snapshot.group,
    display,
    displayId,
    mode,
    epoch: snapshot.epoch,
    epochMs: snapshot.epochMs,
    dwellMs,
    dwellSource,
    settings: snapshot.settings,
    layout: snapshot.layout,
    playlist: snapshot.playlist,
    images: snapshot.images,
    displays: snapshot.displays,
    publication: site.publication ?? null,
    pattern,
    validation: { issues, summary: summarizeIssues(issues) },
  };
}

export function manifestForGroup(site, groupId, options = {}) {
  const group = (site.groups ?? []).find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const displays = (site.displays ?? []).filter((display) => display.groupId === groupId);
  if (displays.length === 0) throw new Error(`Group ${groupId} has no displays`);
  return manifestForDisplay(site, displays[0].id, options);
}
