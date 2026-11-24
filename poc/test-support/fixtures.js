// SPDX-License-Identifier: Apache-2.0
import {
  buildLayout,
  createSnapshot,
  DEFAULT_DWELL_MS,
} from '../packages/engine/index.js';

export const FIXTURE_EPOCH = Date.parse('2026-11-24T09:00:00.000Z');

export function makeImage(index, options = {}) {
  const width = options.width ?? (index % 3 === 1 ? 1200 : 1920);
  const height = options.height ?? (index % 3 === 2 ? 1920 : 1080);
  return {
    id: options.id ?? `img-${index}`,
    filename: `fixture-${index}.svg`,
    width,
    height,
    aspectRatio: width / height,
    mime: 'image/svg+xml',
    size: 2048 + index,
    checksum: `checksum-${index}`,
    displayUrl: `/media/fixture-${index}.svg`,
    thumbnailUrl: `/media/fixture-${index}.svg`,
    createdAt: '2026-11-24T08:00:00.000Z',
  };
}

export function makeDisplays(count, options = {}) {
  return Array.from({ length: count }, (_, index) => {
    const portrait = options.portraitIndexes?.includes(index) ?? false;
    return {
      id: options.ids?.[index] ?? `disp-${index + 1}`,
      groupId: options.groupId ?? 'group-1',
      name: `Display ${index + 1}`,
      hardwareId: `hw-${index + 1}`,
      slotId: options.slotIds?.[index] ?? `slot-${index + 1}`,
      resolution: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
      orientation: portrait ? 'portrait' : 'landscape',
      rotation: options.rotations?.[index] ?? 0,
      status: options.statuses?.[index] ?? 'online',
      startIndex: options.startIndexes?.[index] ?? index,
      step: options.steps?.[index] ?? 1,
      pairingState: 'paired',
    };
  });
}

export function makeSite({
  imageCount = 3,
  displayCount = 4,
  mode = 'synchronized-cycle',
  layoutType,
  epoch = FIXTURE_EPOCH,
  dwellMs = DEFAULT_DWELL_MS,
  displayOptions = {},
  gap = 0.01,
} = {}) {
  const images = Array.from({ length: imageCount }, (_, index) => makeImage(index));
  const items = images.map((image, index) => ({
    id: `item-${index}`,
    imageId: image.id,
    durationMs: dwellMs,
    fitMode: 'contain',
    transitionMs: 300,
    enabled: true,
  }));
  const type = layoutType ?? (displayCount === 1 ? 'single' : displayCount <= 4 ? 'row' : 'grid');
  const layout = buildLayout({
    id: 'layout-1',
    name: 'Fixture layout',
    type,
    displayCount,
    gap,
    canvasWidth: 3840,
    canvasHeight: type === 'grid' ? 2160 : 1080,
    ...(type === 'custom'
      ? {
          slots: Array.from({ length: displayCount }, (_, index) => ({
            id: `slot-${index + 1}`,
            x: (index % 2) * 0.5 + 0.01,
            y: Math.floor(index / 2) * (1 / Math.ceil(displayCount / 2)) + 0.01,
            w: 0.48,
            h: 1 / Math.ceil(displayCount / 2) - 0.02,
          })),
        }
      : {}),
  });
  const displays = makeDisplays(displayCount, displayOptions);
  const playlist = { id: 'playlist-1', name: 'Fixture playlist', items };
  const group = {
    id: 'group-1',
    siteId: 'site-1',
    name: 'Fixture group',
    layoutId: layout.id,
    playlistId: playlist.id,
    playbackMode: mode,
    epoch: new Date(epoch).toISOString(),
    settings: { dwellMs, transitionMs: 300, fit: 'contain' },
  };
  const publication = {
    version: 1,
    siteId: 'site-1',
    epoch: new Date(epoch).toISOString(),
    publishedAt: new Date(epoch - 60_000).toISOString(),
    publishedBy: 'fixture',
  };
  const site = {
    id: 'site-1',
    name: 'Fixture site',
    timezone: 'Asia/Seoul',
    siteKey: 'fixture-key',
    groups: [group],
    displays,
    layouts: [layout],
    playlists: [playlist],
    images,
    publication,
  };
  const snapshot = createSnapshot({
    site,
    group,
    layout,
    playlist,
    displays,
    images,
    mode,
    epoch,
    dwellMs,
  });
  return { site, group, layout, playlist, displays, images, publication, snapshot };
}

export function withMode(snapshot, mode) {
  return { ...snapshot, mode, group: { ...snapshot.group, playbackMode: mode } };
}

export function timeAtSlot(snapshot, slot, dwellMs = snapshot.dwellMs ?? DEFAULT_DWELL_MS) {
  return snapshot.epochMs + slot * dwellMs + Math.min(500, dwellMs / 4);
}

export function idsAtSlot(snapshot, slot) {
  return snapshot.displays.map((display) => {
    const at = timeAtSlot(snapshot, slot);
    return snapshot.playlist.items[
      ((display.startIndex ?? 0) + (display.step ?? 1) * slot) % snapshot.playlist.items.length
    ]?.imageId ?? null;
  });
}
