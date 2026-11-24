// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { lcm, patternPreview } from '../index.js';
import { makeSite } from '../../../test-support/fixtures.js';

test('LCM handles typical signage counts and zero', () => {
  assert.equal(lcm(3, 4), 12);
  assert.equal(lcm(4, 4), 4);
  assert.equal(lcm(10, 8), 40);
  assert.equal(lcm(1, 8), 8);
  assert.equal(lcm(0, 8), 0);
  assert.equal(lcm(8, 0), 0);
});

test('pattern preview shows 12 slots for 3 images and 4 displays', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const preview = patternPreview(snapshot);
  assert.equal(preview.periodSlots, 12);
  assert.equal(preview.rows.length, 12);
  assert.equal(preview.rows[0].cells.map((cell) => cell.imageIndex).join(','), '0,1,2,0');
  assert.equal(preview.rows[3].cells.map((cell) => cell.imageIndex).join(','), '0,1,2,0');
  assert(preview.warnings.some((item) => item.code === 'DUPLICATE_IMAGES_ON_DISPLAYS'));
});

test('pattern preview shows 40 slots for 10 images and 8 displays', () => {
  const { snapshot } = makeSite({ imageCount: 10, displayCount: 8, mode: 'synchronized-cycle', layoutType: 'grid' });
  const preview = patternPreview(snapshot);
  assert.equal(preview.periodSlots, 40);
  assert.equal(preview.rows.length, 40);
  assert.equal(preview.rows[0].cells.length, 8);
  assert.equal(new Set(preview.rows[0].cells.map((cell) => cell.imageId)).size, 8);
  assert.equal(preview.rows[10].cells[0].imageIndex, 0);
});

test('pattern preview handles zero images and one image', () => {
  const empty = makeSite({ imageCount: 0, displayCount: 4 }).snapshot;
  const emptyPreview = patternPreview(empty);
  assert.equal(emptyPreview.periodSlots, 0);
  assert.deepEqual(emptyPreview.rows, []);
  assert(emptyPreview.warnings.some((item) => item.code === 'NO_IMAGES'));

  const single = makeSite({ imageCount: 1, displayCount: 8, layoutType: 'grid' }).snapshot;
  const singlePreview = patternPreview(single);
  assert.equal(singlePreview.periodSlots, 8);
  assert(singlePreview.rows.every((row) => row.cells.every((cell) => cell.imageIndex === 0)));
});

test('pattern preview truncates safely above maxSlots', () => {
  const { snapshot } = makeSite({ imageCount: 10, displayCount: 8, layoutType: 'grid' });
  const preview = patternPreview(snapshot, { maxSlots: 5 });
  assert.equal(preview.periodSlots, 40);
  assert.equal(preview.rows.length, 5);
  assert.equal(preview.truncated, true);
  assert(preview.warnings.some((item) => item.code === 'PATTERN_TRUNCATED'));
});

test('mirror pattern is identical on all displays', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'mirror' });
  const preview = patternPreview(snapshot);
  for (const row of preview.rows) {
    assert.equal(new Set(row.cells.map((cell) => cell.imageIndex)).size, 1);
  }
});
