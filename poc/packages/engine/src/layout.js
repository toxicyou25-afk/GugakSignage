// SPDX-License-Identifier: Apache-2.0
import { LAYOUT_TYPES, isFiniteNumber, round } from '../types.js';

function assertDisplayCount(displayCount) {
  if (!Number.isInteger(displayCount) || displayCount < 1) {
    throw new Error('displayCount must be a positive integer');
  }
}

function assertGap(gap) {
  if (!isFiniteNumber(gap) || gap < 0 || gap > 0.25) {
    throw new Error('gap must be a number between 0 and 0.25');
  }
}

function divisorPairFor(displayCount) {
  let best = null;
  for (let rows = 1; rows <= displayCount; rows += 1) {
    if (displayCount % rows !== 0) continue;
    const columns = displayCount / rows;
    const score = Math.abs(Math.log(columns / rows));
    if (!best || score < best.score || (score === best.score && columns >= rows)) {
      best = { rows, columns, score };
    }
  }
  return best;
}

/**
 * Choose a balanced grid. Perfect factors win (8 -> 4x2, 6 -> 3x2); primes
 * fall back to a near-square grid with empty cells.
 */
export function chooseGrid(displayCount, columns, rows) {
  assertDisplayCount(displayCount);
  if (columns !== undefined) {
    if (!Number.isInteger(columns) || columns < 1) throw new Error('columns must be positive');
    const calculatedRows = rows ?? Math.ceil(displayCount / columns);
    if (!Number.isInteger(calculatedRows) || calculatedRows < 1 || calculatedRows * columns < displayCount) {
      throw new Error('rows x columns must have room for every display');
    }
    return { columns, rows: calculatedRows };
  }
  const pair = divisorPairFor(displayCount);
  if (pair && pair.rows * pair.columns === displayCount) {
    return { columns: pair.columns, rows: pair.rows };
  }
  const nearColumns = Math.ceil(Math.sqrt(displayCount));
  return { columns: nearColumns, rows: Math.ceil(displayCount / nearColumns) };
}

/**
 * Build a normalized layout. Canvas dimensions are only metadata/units; every
 * slot rect is always normalized 0..1 so it scales to any virtual board.
 */
export function buildLayout({
  id = 'layout-auto',
  name = 'Auto layout',
  type = 'row',
  displayCount = 1,
  gap = 0.01,
  columns,
  rows,
  canvasWidth,
  canvasHeight,
  slots,
  bezel = 0,
  safeArea,
} = {}) {
  if (!LAYOUT_TYPES.includes(type)) throw new Error(`Unknown layout type ${type}`);
  assertDisplayCount(displayCount);
  assertGap(gap);

  if (type === 'custom') {
    if (!Array.isArray(slots) || slots.length === 0) throw new Error('custom layouts require slots');
    const customSlots = slots.map((slot, index) => ({
      id: slot.id ?? `slot-${index + 1}`,
      x: round(slot.x, 6),
      y: round(slot.y, 6),
      w: round(slot.w, 6),
      h: round(slot.h, 6),
      ...(slot.displayId ? { displayId: slot.displayId } : {}),
      ...(slot.rotation !== undefined ? { rotation: slot.rotation } : {}),
    }));
    return {
      id,
      name,
      type,
      canvasWidth: canvasWidth ?? 3840,
      canvasHeight: canvasHeight ?? 2160,
      slots: customSlots,
      gap,
      bezel,
      ...(safeArea ? { safeArea } : {}),
    };
  }

  if (type === 'single') {
    if (displayCount !== 1) throw new Error('single layout requires exactly one display');
    return {
      id,
      name,
      type,
      canvasWidth: canvasWidth ?? 1920,
      canvasHeight: canvasHeight ?? 1080,
      slots: [{ id: 'slot-1', x: 0, y: 0, w: 1, h: 1 }],
      gap: 0,
      bezel,
      ...(safeArea ? { safeArea } : {}),
    };
  }

  let gridColumns;
  let gridRows;
  if (type === 'row') {
    gridColumns = displayCount;
    gridRows = 1;
  } else if (type === 'column') {
    gridColumns = 1;
    gridRows = displayCount;
  } else {
    const grid = chooseGrid(displayCount, columns, rows);
    gridColumns = grid.columns;
    gridRows = grid.rows;
  }

  if (gap * (gridColumns - 1) >= 1 || gap * (gridRows - 1) >= 1) {
    throw new Error('gap leaves no room for slots');
  }
  const slotW = (1 - gap * (gridColumns - 1)) / gridColumns;
  const slotH = (1 - gap * (gridRows - 1)) / gridRows;
  const generated = [];
  let index = 0;
  for (let row = 0; row < gridRows && index < displayCount; row += 1) {
    for (let column = 0; column < gridColumns && index < displayCount; column += 1) {
      generated.push({
        id: `slot-${index + 1}`,
        x: round(column * (slotW + gap), 6),
        y: round(row * (slotH + gap), 6),
        w: round(slotW, 6),
        h: round(slotH, 6),
      });
      index += 1;
    }
  }

  return {
    id,
    name,
    type,
    canvasWidth: canvasWidth ?? gridColumns * 1920,
    canvasHeight: canvasHeight ?? gridRows * 1080,
    slots: generated,
    gap,
    bezel,
    ...(safeArea ? { safeArea } : {}),
  };
}

/**
 * Assign displays to slots by stable display identity. Explicit slotId or
 * slotIndex wins; the rest fill unoccupied slots in display order. This is
 * what keeps a display's position stable when another display is added or
 * removed.
 */
export function assignDisplays(layout, displays) {
  const slots = (layout?.slots ?? []).map((slot) => ({ ...slot, display: null }));
  const usedDisplayIds = new Set();
  const byDisplay = new Map();

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  for (const display of displays) {
    let slot = null;
    if (display.slotId && slotById.has(display.slotId)) slot = slotById.get(display.slotId);
    else if (Number.isInteger(display.slotIndex) && slots[display.slotIndex]) slot = slots[display.slotIndex];
    if (slot && !slot.display && !usedDisplayIds.has(display.id)) {
      slot.display = display;
      usedDisplayIds.add(display.id);
      byDisplay.set(display.id, slot);
    }
  }

  for (const slot of slots) {
    if (slot.display) continue;
    if (slot.displayId) {
      const explicit = displays.find((display) => display.id === slot.displayId);
      if (explicit && !usedDisplayIds.has(explicit.id)) {
        slot.display = explicit;
        usedDisplayIds.add(explicit.id);
        byDisplay.set(explicit.id, slot);
        continue;
      }
    }
    const next = displays.find((display) => !usedDisplayIds.has(display.id));
    if (!next) break;
    slot.display = next;
    usedDisplayIds.add(next.id);
    byDisplay.set(next.id, slot);
  }

  const emptySlots = slots.filter((slot) => !slot.display);
  const unassignedDisplays = displays.filter((display) => !usedDisplayIds.has(display.id));
  return { slots, byDisplay, emptySlots, unassignedDisplays };
}

export function slotForDisplay(layout, displays, displayId) {
  return assignDisplays(layout, displays).byDisplay.get(displayId) ?? null;
}

export function reflowLayout(layout, displayCount, options = {}) {
  assertDisplayCount(displayCount);
  if (layout.type === 'custom') {
    const copy = {
      ...layout,
      slots: layout.slots.map((slot) => ({ ...slot })),
    };
    if (displayCount > copy.slots.length) {
      const error = new Error('custom layout has no empty slot for the new display');
      error.code = 'CUSTOM_LAYOUT_FULL';
      throw error;
    }
    return copy;
  }
  const type = options.type ?? layout.type;
  const count = type === 'single' ? 1 : displayCount;
  const built = buildLayout({
    ...layout,
    type,
    displayCount: count,
    gap: options.gap ?? layout.gap ?? 0.01,
    columns: options.columns,
    rows: options.rows,
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
  });
  return built;
}

/**
 * Return a display's layout slot and a normalized center for preview labels.
 */
export function slotGeometry(layout, displays, displayId) {
  const slot = slotForDisplay(layout, displays, displayId);
  if (!slot) return null;
  return {
    id: slot.id,
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    centerX: slot.x + slot.w / 2,
    centerY: slot.y + slot.h / 2,
  };
}

export function rectToPixels(rect, width, height) {
  return {
    x: round(rect.x * width, 3),
    y: round(rect.y * height, 3),
    w: round(rect.w * width, 3),
    h: round(rect.h * height, 3),
  };
}

export function displayViewport(display) {
  return { width: display.resolution.width, height: display.resolution.height };
}
