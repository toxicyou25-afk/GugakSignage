// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_TRANSITION_MS, FIT_MODES, isFiniteNumber } from '../types.js';
import { computeCanvasGeometry, computeFitGeometry } from './image.js';
import { slotForDisplay } from './layout.js';
import { resolveTimeline, resolveMode } from './timeline.js';
import { validateImageCounts, validateImageFit } from './validation.js';

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function fitFor(snapshot, display, item, mode) {
  const candidates = [
    item?.fitMode,
    display?.fit,
    snapshot?.settings?.fit,
    snapshot?.group?.settings?.fit,
    mode === 'canvas' ? 'cover' : 'contain',
  ];
  return candidates.find((value) => FIT_MODES.includes(value)) ?? 'contain';
}

function transitionFor(snapshot, item) {
  const candidate =
    item?.transitionMs ??
    snapshot?.settings?.transitionMs ??
    snapshot?.group?.settings?.transitionMs ??
    DEFAULT_TRANSITION_MS;
  return isFiniteNumber(candidate) && candidate >= 0 ? candidate : DEFAULT_TRANSITION_MS;
}

/**
 * The only function an output module needs: given a snapshot and a display,
 * produce exactly what to draw now and when to re-evaluate.
 */
export function buildRenderPlan(snapshot, displayId, atMs = Date.now(), options = {}) {
  if (!Number.isFinite(atMs)) throw new Error('atMs must be a finite timestamp');
  const display = (snapshot.displays ?? []).find((candidate) => candidate.id === displayId);
  if (!display) throw new Error(`Unknown display ${displayId}`);
  const mode = resolveMode(snapshot);
  const timeline = resolveTimeline(snapshot, displayId, atMs);
  const viewport = { ...display.resolution };
  const rotation = [0, 90, 180, 270].includes(display.rotation) ? display.rotation : 0;
  const imageCount = snapshot.playlist?.items?.length ?? 0;
  const displayCount = snapshot.displays?.length ?? 0;
  const transitionMs = transitionFor(snapshot, timeline.item);
  const baseFit = fitFor(snapshot, display, timeline.item, mode);
  const warnings = [...validateImageCounts(imageCount, displayCount)];
  if (display.status && display.status !== 'online') {
    warnings.push({
      code: 'DISPLAY_OFFLINE',
      severity: 'warning',
      path: 'display',
      message: `Display ${display.id} is ${display.status}; showing cached plan.`,
    });
  }

  const base = {
    displayId,
    displayName: display.name,
    siteId: snapshot.site?.id ?? snapshot.group?.siteId ?? null,
    at: iso(atMs),
    atMs,
    mode,
    epochMs: timeline.epochMs,
    dwellMs: timeline.dwellMs,
    imageCount,
    displayCount,
    imageIndex: timeline.imageIndex,
    imageId: timeline.imageId,
    itemId: timeline.item?.id ?? null,
    image: timeline.image,
    imageUrl: timeline.image?.displayUrl ?? null,
    rotation,
    fit: baseFit,
    opacity: 1,
    transitionMs,
    slot: timeline.slot,
    slotId: null,
    slotRect: null,
    cycleIndex: timeline.cycleIndex,
    offsetMs: timeline.offsetMs,
    slotStartMs: timeline.slotStartMs,
    slotStartAt: iso(timeline.slotStartMs),
    nextChangeAtMs: timeline.nextChangeAtMs,
    nextChangeAt: iso(timeline.nextChangeAtMs),
    static: timeline.static,
    placeholder: false,
    viewport,
    warnings: [],
  };

  if (imageCount === 0 || !timeline.image) {
    return {
      ...base,
      sourceRect: null,
      destinationRect: { x: 0, y: 0, w: viewport.width, h: viewport.height },
      placeholder: true,
      placeholderReason: imageCount === 0 ? 'no-images' : 'missing-image',
      nextChangeAtMs: null,
      nextChangeAt: null,
      static: true,
      warnings: dedupeIssues([
        ...warnings,
        ...(imageCount > 0
          ? [
              {
                code: 'IMAGE_ASSET_MISSING',
                severity: 'error',
                path: 'playlist.items',
                message: `Playlist references missing image ${timeline.imageId}.`,
              },
            ]
          : []),
      ]),
    };
  }

  warnings.push(...validateImageFit(timeline.image, viewport, baseFit, { path: 'image' }));
  const slot = slotForDisplay(snapshot.layout, snapshot.displays, displayId);
  if (!slot) {
    warnings.push({
      code: 'NO_LAYOUT_SLOT',
      severity: 'warning',
      path: 'layout',
      message: `Display ${displayId} has no layout slot; using a full-screen fit.`,
    });
  }
  let geometry;
  if (mode === 'canvas' && slot) {
    geometry = computeCanvasGeometry(timeline.image, snapshot.layout, slot, viewport, baseFit, rotation);
    if (rotation === 90 || rotation === 270) {
      warnings.push({
        code: 'CANVAS_ROTATION_UNVERIFIED',
        severity: 'warning',
        path: 'display.rotation',
        message: 'Canvas crop plus 90/270 rotation is a PoC limitation; use rotation 0/180 for canvas walls.',
      });
    }
  } else {
    geometry = computeFitGeometry(timeline.image, viewport, baseFit, rotation);
  }

  return {
    ...base,
    fit: geometry.fit,
    rotation: geometry.rotation,
    sourceRect: geometry.sourceRect,
    destinationRect: geometry.destinationRect,
    letterbox: Boolean(geometry.letterbox),
    slotId: slot?.id ?? null,
    slotRect: slot ? { x: slot.x, y: slot.y, w: slot.w, h: slot.h } : null,
    warnings: dedupeIssues(warnings),
    ...(options.extra ? options.extra : {}),
  };
}

export function buildPlanSeries(snapshot, displayId, startMs, count, stepMs) {
  const plans = [];
  for (let index = 0; index < count; index += 1) {
    plans.push(buildRenderPlan(snapshot, displayId, startMs + index * stepMs));
  }
  return plans;
}
