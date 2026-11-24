// SPDX-License-Identifier: Apache-2.0
import { isFiniteNumber } from '../types.js';
import { resolveDwell, resolveEpochMs, resolveTimeline, resolveMode } from './timeline.js';
import { validateImageCounts } from './validation.js';

export function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export function lcm(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 0;
  if (a === 0 || b === 0) return 0;
  return Math.abs((a / gcd(a, b)) * b);
}

/**
 * Pattern preview up to LCM(N, M). This is a planning aid, not playback state:
 * it samples the same pure timeline used by players and preview.
 */
export function patternPreview(snapshot, options = {}) {
  const maxSlots = options.maxSlots ?? 120;
  const items = snapshot.playlist?.items ?? [];
  const displays = snapshot.displays ?? [];
  const imageCount = items.length;
  const displayCount = displays.length;
  const mode = resolveMode(snapshot);
  const period = lcm(imageCount, displayCount);
  const warnings = [...validateImageCounts(imageCount, displayCount)];
  if (period > maxSlots) {
    warnings.push({
      code: 'PATTERN_TRUNCATED',
      severity: 'info',
      path: 'pattern',
      message: `Pattern period ${period} exceeds ${maxSlots}; preview is truncated.`,
    });
  }
  if (imageCount === 0 || displayCount === 0) {
    return {
      mode,
      imageCount,
      displayCount,
      periodSlots: period,
      displayedSlots: 0,
      truncated: false,
      rows: [],
      warnings,
    };
  }
  const epochMs = resolveEpochMs(snapshot);
  const { dwellMs } = resolveDwell(snapshot);
  const rows = [];
  const displayedSlots = Math.min(period, maxSlots);
  for (let slot = 0; slot < displayedSlots; slot += 1) {
    const atMs = epochMs + slot * dwellMs + Math.min(dwellMs / 2, 100);
    const cells = [];
    const seen = new Map();
    for (const display of displays) {
      const timeline = resolveTimeline(snapshot, display.id, atMs);
      const imageIndex = timeline.imageIndex;
      const imageId = timeline.imageId;
      cells.push({ displayId: display.id, imageIndex, imageId, placeholder: imageIndex === null });
      if (imageId) seen.set(imageId, (seen.get(imageId) ?? 0) + 1);
    }
    rows.push({
      slot,
      at: new Date(atMs).toISOString(),
      cells,
      duplicatesOnDisplays: [...seen.entries()].filter(([, count]) => count > 1).map(([imageId]) => imageId),
    });
  }
  if (imageCount < displayCount) {
    warnings.push({
      code: 'DUPLICATE_IMAGES_ON_DISPLAYS',
      severity: 'warning',
      path: 'pattern',
      message: 'The pattern repeats some images because there are fewer images than displays.',
    });
  }
  if (mode !== 'individual') {
    const durations = items.map((item) => item.durationMs);
    if (durations.some((value) => !isFiniteNumber(value) || value <= 0) || new Set(durations).size > 1) {
      warnings.push({
        code: 'SYNC_DURATION_OVERRIDE',
        severity: 'info',
        path: 'pattern',
        message: 'Synchronized pattern rows use the group dwell, not individual item durations.',
      });
    }
  }
  return {
    mode,
    imageCount,
    displayCount,
    periodSlots: period,
    displayedSlots,
    truncated: period > displayedSlots,
    dwellMs,
    epoch: new Date(epochMs).toISOString(),
    rows,
    warnings,
  };
}
