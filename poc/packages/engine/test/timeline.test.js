// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRenderPlan,
  resolveTimeline,
} from '../index.js';
import { FIXTURE_EPOCH, makeSite, timeAtSlot } from '../../../test-support/fixtures.js';

function indexes(snapshot, atMs) {
  return snapshot.displays.map((display) => resolveTimeline(snapshot, display.id, atMs).imageIndex);
}

test('synchronized cycle distributes offsets at slot zero and rotates together', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 0)), [0, 1, 2, 0]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 1)), [1, 2, 0, 1]);
  const timeline = resolveTimeline(snapshot, 'disp-1', timeAtSlot(snapshot, 1));
  assert.equal(timeline.slot, 1);
  assert.equal(timeline.nextChangeAtMs, FIXTURE_EPOCH + 2 * snapshot.dwellMs);
  assert(timeline.offsetMs > 0);
});

test('synchronized cycle honors negative step', () => {
  const { snapshot } = makeSite({
    imageCount: 3,
    displayCount: 3,
    mode: 'synchronized-cycle',
    displayOptions: { steps: [-1, -1, -1] },
  });
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 0)), [0, 1, 2]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 1)), [2, 0, 1]);
});

test('mirror ignores per-display offsets and shows one image everywhere', () => {
  const { snapshot } = makeSite({
    imageCount: 10,
    displayCount: 4,
    mode: 'mirror',
    displayOptions: { startIndexes: [7, 4, 2, 9], steps: [-1, 3, 0, 2] },
  });
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 0)), [0, 0, 0, 0]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 2)), [2, 2, 2, 2]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 10)), [0, 0, 0, 0]);
});

test('canvas mode selects one image for the whole wall', () => {
  const { snapshot } = makeSite({ imageCount: 10, displayCount: 6, mode: 'canvas', layoutType: 'grid' });
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 3)), [3, 3, 3, 3, 3, 3]);
  const plan = buildRenderPlan(snapshot, 'disp-6', timeAtSlot(snapshot, 3));
  assert.equal(plan.mode, 'canvas');
  assert.equal(plan.slotId, 'slot-6');
  assert(plan.sourceRect.w > 0);
  assert(plan.sourceRect.h > 0);
});

test('individual mode wraps each display playlist on its own offset', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'individual' });
  snapshot.displays.forEach((display, index) => {
    display.startOffsetMs = index * snapshot.dwellMs;
  });
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 0)), [0, 1, 2, 0]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 1)), [1, 2, 0, 1]);
  assert.deepEqual(indexes(snapshot, timeAtSlot(snapshot, 3)), [0, 1, 2, 0]);
});

test('individual mode uses per-item durations and reports the next boundary', () => {
  const { snapshot } = makeSite({ imageCount: 2, displayCount: 1, mode: 'individual', dwellMs: 10_000 });
  snapshot.playlist.items[0].durationMs = 4_000;
  snapshot.playlist.items[1].durationMs = 6_000;
  const first = resolveTimeline(snapshot, 'disp-1', FIXTURE_EPOCH + 1_000);
  const second = resolveTimeline(snapshot, 'disp-1', FIXTURE_EPOCH + 5_000);
  assert.equal(first.itemIndex, 0);
  assert.equal(second.itemIndex, 1);
  assert.equal(first.nextChangeAtMs, FIXTURE_EPOCH + 4_000);
  assert.equal(second.nextChangeAtMs, FIXTURE_EPOCH + 10_000);
});

test('zero images returns a placeholder plan rather than throwing', () => {
  const { snapshot } = makeSite({ imageCount: 0, displayCount: 4 });
  for (const display of snapshot.displays) {
    const plan = buildRenderPlan(snapshot, display.id, timeAtSlot(snapshot, 0));
    assert.equal(plan.placeholder, true);
    assert.equal(plan.imageId, null);
    assert.equal(plan.sourceRect, null);
    assert.equal(plan.nextChangeAtMs, null);
    assert(plan.warnings.some((item) => item.code === 'NO_IMAGES'));
  }
});

test('one image stays static on every display', () => {
  const { snapshot } = makeSite({ imageCount: 1, displayCount: 8, mode: 'synchronized-cycle', layoutType: 'grid' });
  for (const display of snapshot.displays) {
    const timeline = resolveTimeline(snapshot, display.id, timeAtSlot(snapshot, 99));
    assert.equal(timeline.imageIndex, 0);
    assert.equal(timeline.nextChangeAtMs, null);
    assert.equal(timeline.static, true);
  }
});

test('all monitor/image counts and all four modes produce valid plans', () => {
  for (const displayCount of [1, 4, 8]) {
    for (const imageCount of [0, 1, 3, 10]) {
      for (const mode of ['individual', 'synchronized-cycle', 'mirror', 'canvas']) {
        const { snapshot } = makeSite({ imageCount, displayCount, mode });
        for (const display of snapshot.displays) {
          const plan = buildRenderPlan(snapshot, display.id, timeAtSlot(snapshot, 2));
          assert.equal(plan.mode, mode);
          assert.equal(plan.displayId, display.id);
          assert(Number.isFinite(plan.destinationRect.w));
          assert(Number.isFinite(plan.destinationRect.h));
          if (imageCount === 0) assert.equal(plan.imageId, null);
          else assert.equal(typeof plan.imageId, 'string');
        }
      }
    }
  }
});

test('N < M repeats images, N = M is one-to-one, N > M rotates the window', () => {
  const fewer = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' }).snapshot;
  assert.deepEqual(indexes(fewer, timeAtSlot(fewer, 0)), [0, 1, 2, 0]);
  const equal = makeSite({ imageCount: 4, displayCount: 4, mode: 'synchronized-cycle' }).snapshot;
  assert.deepEqual(indexes(equal, timeAtSlot(equal, 0)), [0, 1, 2, 3]);
  const more = makeSite({ imageCount: 10, displayCount: 4, mode: 'synchronized-cycle' }).snapshot;
  assert.deepEqual(indexes(more, timeAtSlot(more, 0)), [0, 1, 2, 3]);
  assert.deepEqual(indexes(more, timeAtSlot(more, 4)), [4, 5, 6, 7]);
  assert.deepEqual(indexes(more, timeAtSlot(more, 10)), [0, 1, 2, 3]);
});

test('late join computes the current slot with no prior playback state', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const lateAt = FIXTURE_EPOCH + 65_000;
  const late = resolveTimeline(snapshot, 'disp-4', lateAt);
  const expectedSlot = Math.floor(65_000 / snapshot.dwellMs);
  assert.equal(late.slot, expectedSlot);
  assert.equal(late.imageIndex, (3 + expectedSlot) % 3);
  const fromFreshReload = resolveTimeline(JSON.parse(JSON.stringify(snapshot)), 'disp-4', lateAt);
  assert.equal(fromFreshReload.imageIndex, late.imageIndex);
  assert.equal(fromFreshReload.slot, late.slot);
});

test('server restart with the same epoch resumes the same image', () => {
  const { snapshot, site } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const at = FIXTURE_EPOCH + 127_321;
  const before = resolveTimeline(snapshot, 'disp-2', at);
  const restoredSnapshot = JSON.parse(JSON.stringify(snapshot));
  const after = resolveTimeline(restoredSnapshot, 'disp-2', at);
  assert.equal(after.imageId, before.imageId);
  assert.equal(after.slot, before.slot);
  assert.equal(after.nextChangeAtMs, before.nextChangeAtMs);
  assert.equal(site.publication.epoch, snapshot.epoch);
});

test('offline time passage keeps advancing the same deterministic timeline', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const offlineAt = FIXTURE_EPOCH + 2_000;
  const offline = resolveTimeline(snapshot, 'disp-1', offlineAt);
  const tenMinutesLater = resolveTimeline(snapshot, 'disp-1', offlineAt + 10 * 60_000);
  assert.equal(tenMinutesLater.slot - offline.slot, 60);
  assert.equal(tenMinutesLater.imageIndex, (offline.imageIndex + 60) % 3);
  assert.equal(tenMinutesLater.nextChangeAtMs - offline.nextChangeAtMs, 60 * snapshot.dwellMs);
});

test('removing a display does not change another display image at the same time', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const at = timeAtSlot(snapshot, 5);
  const before = resolveTimeline(snapshot, 'disp-3', at);
  const without2 = { ...snapshot, displays: snapshot.displays.filter((display) => display.id !== 'disp-2') };
  const after = resolveTimeline(without2, 'disp-3', at);
  assert.equal(after.imageId, before.imageId);
  assert.equal(after.slot, before.slot);
});

test('adding a display assigns the open slot without resetting existing positions', () => {
  const { snapshot } = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' });
  const at = timeAtSlot(snapshot, 4);
  const before = buildRenderPlan(snapshot, 'disp-1', at);
  const newDisplay = {
    id: 'disp-new',
    groupId: 'group-1',
    name: 'New display',
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
    rotation: 0,
    startIndex: 99,
    step: 1,
    status: 'online',
  };
  const without2 = {
    ...snapshot,
    displays: [...snapshot.displays.filter((display) => display.id !== 'disp-2'), newDisplay],
  };
  const after = buildRenderPlan(without2, 'disp-1', at);
  const added = buildRenderPlan(without2, 'disp-new', at);
  assert.equal(after.imageId, before.imageId);
  assert.equal(added.slotId, 'slot-2');
  assert.equal(added.imageIndex, (99 + 4) % 3);
});
