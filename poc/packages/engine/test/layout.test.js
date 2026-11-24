// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignDisplays,
  buildLayout,
  chooseGrid,
  reflowLayout,
  slotForDisplay,
} from '../index.js';
import { makeDisplays } from '../../../test-support/fixtures.js';

function assertWithinUnit(slot) {
  assert(slot.x >= 0 && slot.y >= 0);
  assert(slot.w > 0 && slot.h > 0);
  assert(slot.x + slot.w <= 1.000001);
  assert(slot.y + slot.h <= 1.000001);
}

test('single layout is one normalized full-canvas slot', () => {
  const layout = buildLayout({ type: 'single', displayCount: 1 });
  assert.equal(layout.slots.length, 1);
  assert.deepEqual(layout.slots[0], { id: 'slot-1', x: 0, y: 0, w: 1, h: 1 });
  assert.throws(() => buildLayout({ type: 'single', displayCount: 2 }));
});

test('row layout for four displays has no gaps, overlaps, or out-of-bounds slots', () => {
  const layout = buildLayout({ type: 'row', displayCount: 4, gap: 0.01 });
  assert.equal(layout.slots.length, 4);
  for (const slot of layout.slots) assertWithinUnit(slot);
  for (let i = 1; i < layout.slots.length; i += 1) {
    assert(layout.slots[i].x > layout.slots[i - 1].x);
    assert.equal(layout.slots[i].y, 0);
  }
  assert.equal(layout.slots[0].x, 0);
  assert(Math.abs(layout.slots[3].x + layout.slots[3].w - 1) < 1e-6);
});

test('column layout for three displays stacks vertically', () => {
  const layout = buildLayout({ type: 'column', displayCount: 3, gap: 0 });
  assert.equal(layout.slots.length, 3);
  assert.deepEqual(layout.slots.map((slot) => slot.y), [0, 0.333333, 0.666667]);
  for (const slot of layout.slots) assert.equal(slot.x, 0);
});

test('grid chooses 4x2 for eight displays and contains all slots', () => {
  assert.deepEqual(chooseGrid(8), { columns: 4, rows: 2 });
  assert.deepEqual(chooseGrid(6), { columns: 3, rows: 2 });
  assert.deepEqual(chooseGrid(4), { columns: 2, rows: 2 });
  const layout = buildLayout({ type: 'grid', displayCount: 8, gap: 0.01 });
  assert.equal(layout.slots.length, 8);
  for (const slot of layout.slots) assertWithinUnit(slot);
  assert.equal(layout.slots[0].x, 0);
  assert.equal(layout.slots[4].y > 0.4, true);
  assert.equal(layout.slots[3].y < 0.1, true);
});

test('grid supports explicit columns and empty trailing cells', () => {
  const layout = buildLayout({ type: 'grid', displayCount: 7, columns: 3, gap: 0 });
  assert.equal(layout.slots.length, 7);
  assert.equal(layout.slots[3].x, 0);
  assert.equal(layout.slots[3].y, 0.333333);
  assert.equal(layout.slots[6].x, 0);
  assert.equal(layout.slots[6].y, 0.666667);
  assert.throws(() => buildLayout({ type: 'grid', displayCount: 7, columns: 3, rows: 2 }));
});

test('layout builders reject invalid counts and impossible gaps', () => {
  assert.throws(() => buildLayout({ type: 'row', displayCount: 0 }));
  assert.throws(() => buildLayout({ type: 'row', displayCount: -1 }));
  assert.throws(() => buildLayout({ type: 'row', displayCount: 3, gap: 0.6 }));
  assert.throws(() => buildLayout({ type: 'custom', displayCount: 2 }));
  assert.throws(() => buildLayout({ type: 'triangle', displayCount: 2 }));
  assert.throws(() => buildLayout({ type: 'grid', displayCount: 8, columns: 2, rows: 2 }));
});

test('custom layout preserves normalized rectangles and explicit slot ids', () => {
  const layout = buildLayout({
    type: 'custom',
    displayCount: 3,
    canvasWidth: 3840,
    canvasHeight: 2160,
    slots: [
      { id: 'left', x: 0, y: 0, w: 0.5, h: 1 },
      { id: 'top-right', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: 'bottom-right', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  });
  assert.deepEqual(layout.slots.map((slot) => slot.id), ['left', 'top-right', 'bottom-right']);
  assert.equal(layout.slots[0].w, 0.5);
});

test('display-to-slot mapping follows display ids, not array positions', () => {
  const displays = makeDisplays(4);
  const layout = buildLayout({ type: 'row', displayCount: 4 });
  const initial = assignDisplays(layout, displays);
  assert.equal(initial.byDisplay.get('disp-1').id, 'slot-1');
  assert.equal(initial.byDisplay.get('disp-4').id, 'slot-4');

  const removed = displays.filter((display) => display.id !== 'disp-2');
  const afterRemove = assignDisplays(layout, removed);
  assert.equal(afterRemove.byDisplay.get('disp-1').id, 'slot-1');
  assert.equal(afterRemove.byDisplay.get('disp-3').id, 'slot-3');
  assert.equal(afterRemove.byDisplay.get('disp-4').id, 'slot-4');
  assert.equal(afterRemove.emptySlots.length, 1);
  assert.equal(afterRemove.emptySlots[0].id, 'slot-2');

  const added = [...removed, { ...makeDisplays(1)[0], id: 'disp-new', name: 'New' }];
  const afterAdd = assignDisplays(layout, added);
  assert.equal(afterAdd.byDisplay.get('disp-3').id, 'slot-3');
  assert.equal(afterAdd.byDisplay.get('disp-new').id, 'slot-2');
});

test('reflowing a row for a new count keeps ids stable and removes the old last slot', () => {
  const displays = makeDisplays(4);
  const layout = buildLayout({ id: 'row-4', type: 'row', displayCount: 4 });
  const withFive = reflowLayout(layout, 5);
  assert.equal(withFive.id, 'row-4');
  assert.equal(withFive.slots.length, 5);
  const mapping = assignDisplays(withFive, [...displays, { ...displays[0], id: 'disp-5', name: 'Five' }]);
  assert.equal(mapping.byDisplay.get('disp-5').id, 'slot-5');
  const withThree = reflowLayout(layout, 3);
  assert.equal(withThree.slots.length, 3);
  assert.equal(slotForDisplay(withThree, displays.slice(0, 3), 'disp-3').id, 'slot-3');
});

test('custom layout removal leaves a recoverable empty slot', () => {
  const layout = buildLayout({
    type: 'custom',
    displayCount: 3,
    slots: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 1 },
      { id: 'b', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: 'c', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  });
  const displays = makeDisplays(3);
  displays[0].slotId = 'a';
  displays[1].slotId = 'b';
  displays[2].slotId = 'c';
  const afterRemove = assignDisplays(layout, [displays[0], displays[2]]);
  assert.equal(afterRemove.emptySlots[0].id, 'b');
  const afterReadd = assignDisplays(layout, displays);
  assert.equal(afterReadd.byDisplay.get('disp-2').id, 'b');
  assert.equal(reflowLayout(layout, 3).slots.length, 3);
  assert.throws(() => reflowLayout(layout, 4), /no empty slot/);
});

test('explicit display slotId wins over array order', () => {
  const layout = buildLayout({ type: 'row', displayCount: 3 });
  const displays = makeDisplays(3);
  displays[0].slotId = undefined;
  displays[1].slotId = undefined;
  displays[2].slotId = 'slot-1';
  const mapping = assignDisplays(layout, displays);
  assert.equal(mapping.byDisplay.get('disp-3').id, 'slot-1');
  assert.equal(mapping.byDisplay.get('disp-1').id, 'slot-2');
});
