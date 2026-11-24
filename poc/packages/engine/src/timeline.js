// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_DWELL_MS, isFiniteNumber, mod } from '../types.js';

export function resolveEpochMs(snapshot) {
  const candidate =
    snapshot?.epochMs ??
    snapshot?.epoch ??
    snapshot?.group?.epochMs ??
    snapshot?.group?.epoch ??
    snapshot?.site?.publication?.epoch;
  if (isFiniteNumber(candidate)) return candidate;
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Snapshot has no valid epoch');
}

export function resolveMode(snapshot) {
  return snapshot?.mode ?? snapshot?.group?.playbackMode ?? 'individual';
}

export function isSynchronizedMode(mode) {
  return mode === 'synchronized-cycle' || mode === 'mirror' || mode === 'canvas';
}

export function playlistDurationMs(playlist) {
  return (playlist?.items ?? []).reduce(
    (total, item) => total + (isFiniteNumber(item.durationMs) && item.durationMs > 0 ? item.durationMs : 0),
    0,
  );
}

export function resolveDwell(snapshot) {
  const items = snapshot?.playlist?.items ?? [];
  const explicit = snapshot?.dwellMs ?? snapshot?.group?.settings?.dwellMs ?? snapshot?.settings?.dwellMs;
  if (isFiniteNumber(explicit) && explicit > 0) return { dwellMs: explicit, source: 'settings' };
  if (items.length > 0) {
    const durations = items.map((item) => item.durationMs);
    if (durations.every((duration) => isFiniteNumber(duration) && duration > 0) && new Set(durations).size === 1) {
      return { dwellMs: durations[0], source: 'playlist' };
    }
  }
  return { dwellMs: DEFAULT_DWELL_MS, source: 'default' };
}

function displayAt(snapshot, displayId) {
  const displays = snapshot?.displays ?? [];
  const index = displays.findIndex((display) => display.id === displayId);
  if (index < 0) throw new Error(`Unknown display ${displayId}`);
  return { display: displays[index], displayIndex: index, displayCount: displays.length };
}

function contentForItem(snapshot, item) {
  const contentId = item?.contentId ?? item?.imageId;
  return (
    (snapshot.contents ?? []).find((content) => content.id === contentId) ??
    (snapshot.images ?? []).find((image) => image.id === contentId) ??
    null
  );
}

function baseTimeline(snapshot, displayId, atMs) {
  const mode = resolveMode(snapshot);
  const { display, displayIndex, displayCount } = displayAt(snapshot, displayId);
  const items = snapshot.playlist?.items ?? [];
  const imageCount = items.length;
  const epochMs = resolveEpochMs(snapshot);
  const { dwellMs, source: dwellSource } = resolveDwell(snapshot);
  return { mode, display, displayIndex, displayCount, items, imageCount, epochMs, dwellMs, dwellSource, atMs };
}

function finish(base, extra) {
  const timeline = { ...base, ...extra };
  timeline.static = timeline.imageCount <= 1 || timeline.nextChangeAtMs === null;
  timeline.content = timeline.item
    ? contentForItem({ contents: base.contents, images: base.images ?? [], playlist: { items: base.items } }, timeline.item)
    : null;
  timeline.kind = timeline.item?.kind ?? timeline.content?.kind ?? 'image';
  timeline.contentId = timeline.item?.contentId ?? timeline.content?.id ?? timeline.item?.imageId ?? null;
  timeline.contentUrl = timeline.item?.contentUrl ?? timeline.content?.url ?? timeline.content?.displayUrl ?? null;
  timeline.image = timeline.kind === 'url' || !timeline.content
    ? null
    : {
        ...timeline.content,
        filename: timeline.content.filename ?? timeline.content.name,
        displayUrl: timeline.content.displayUrl ?? timeline.content.url,
      };
  timeline.imageId = timeline.contentId;
  return timeline;
}

function synchronizedTimeline(snapshot, displayId, atMs) {
  const base = baseTimeline(snapshot, displayId, atMs);
  base.contents = snapshot.contents;
  base.images = snapshot.images;
  const { mode, display, displayIndex, imageCount, epochMs, dwellMs } = base;
  if (imageCount === 0) {
    return finish(base, {
      empty: true,
      slot: null,
      itemIndex: null,
      imageIndex: null,
      item: null,
      slotStartMs: null,
      offsetMs: 0,
      nextChangeAtMs: null,
      cycleIndex: null,
    });
  }
  const elapsed = atMs - epochMs;
  const slot = Math.floor(elapsed / dwellMs);
  const slotStartMs = epochMs + slot * dwellMs;
  const offsetMs = atMs - slotStartMs;
  const nextChangeAtMs = imageCount <= 1 ? null : slotStartMs + dwellMs;
  let startIndex;
  let step;
  if (mode === 'mirror') {
    startIndex = snapshot.settings?.mirrorStartIndex ?? snapshot.group?.settings?.mirrorStartIndex ?? 0;
    step = snapshot.settings?.mirrorStep ?? snapshot.group?.settings?.mirrorStep ?? 1;
  } else if (mode === 'canvas') {
    startIndex = snapshot.settings?.canvasStartIndex ?? snapshot.group?.settings?.canvasStartIndex ?? 0;
    step = snapshot.settings?.canvasStep ?? snapshot.group?.settings?.canvasStep ?? 1;
  } else {
    startIndex = Number.isInteger(display.startIndex) ? display.startIndex : displayIndex;
    step = Number.isInteger(display.step) ? display.step : 1;
  }
  const itemIndex = mod(startIndex + step * slot, imageCount);
  const item = base.items[itemIndex];
  return finish(base, {
    empty: false,
    slot,
    itemIndex,
    imageIndex: itemIndex,
    item,
    slotStartMs,
    offsetMs,
    nextChangeAtMs,
    cycleIndex: Math.floor(slot / imageCount),
    startIndex,
    step,
  });
}

function individualTimeline(snapshot, displayId, atMs) {
  const base = baseTimeline(snapshot, displayId, atMs);
  base.contents = snapshot.contents;
  base.images = snapshot.images;
  const { display, imageCount, epochMs, items } = base;
  if (imageCount === 0) {
    return finish(base, {
      empty: true,
      slot: null,
      itemIndex: null,
      imageIndex: null,
      item: null,
      slotStartMs: null,
      offsetMs: 0,
      nextChangeAtMs: null,
      cycleIndex: null,
    });
  }
  const total = playlistDurationMs(snapshot.playlist);
  if (total <= 0) {
    return finish(base, {
      empty: false,
      slot: null,
      itemIndex: 0,
      imageIndex: 0,
      item: items[0],
      slotStartMs: epochMs,
      offsetMs: 0,
      nextChangeAtMs: null,
      cycleIndex: 0,
    });
  }
  let startOffsetMs = isFiniteNumber(display.startOffsetMs) ? display.startOffsetMs : 0;
  if (!isFiniteNumber(display.startOffsetMs) && Number.isInteger(display.startIndex)) {
    startOffsetMs = items
      .slice(0, display.startIndex % imageCount)
      .reduce((sum, item) => sum + (item.durationMs > 0 ? item.durationMs : 0), 0);
  }
  const local = atMs - epochMs + startOffsetMs;
  const cycleIndex = Math.floor(local / total);
  const inCycle = local - cycleIndex * total;
  let cumulative = 0;
  let itemIndex = 0;
  for (let index = 0; index < items.length; index += 1) {
    const duration = items[index].durationMs > 0 ? items[index].durationMs : 0;
    if (inCycle < cumulative + duration || index === items.length - 1) {
      itemIndex = index;
      break;
    }
    cumulative += duration;
  }
  const duration = items[itemIndex].durationMs;
  const slotStartMs = epochMs - startOffsetMs + cycleIndex * total + cumulative;
  const nextChangeAtMs = imageCount <= 1 ? null : slotStartMs + duration;
  return finish(base, {
    empty: false,
    slot: cycleIndex * imageCount + itemIndex,
    itemIndex,
    imageIndex: itemIndex,
    item: items[itemIndex],
    slotStartMs,
    offsetMs: atMs - slotStartMs,
    nextChangeAtMs,
    cycleIndex,
    startOffsetMs,
  });
}

/**
 * Pure timeline resolution. Late join, restart, and offline playback all call
 * this same function with a different clock value; no previous state is kept.
 */
export function resolveTimeline(snapshot, displayId, atMs = Date.now()) {
  if (!isFiniteNumber(atMs)) throw new Error('atMs must be a finite timestamp');
  const mode = resolveMode(snapshot);
  if (mode === 'individual') return individualTimeline(snapshot, displayId, atMs);
  return synchronizedTimeline(snapshot, displayId, atMs);
}

export function imageAt(snapshot, displayId, atMs) {
  return resolveTimeline(snapshot, displayId, atMs);
}

export function currentSlotStart(snapshot, displayId, atMs) {
  const timeline = resolveTimeline(snapshot, displayId, atMs);
  return timeline.slotStartMs;
}
