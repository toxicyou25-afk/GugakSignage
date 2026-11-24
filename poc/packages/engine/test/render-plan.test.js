// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRenderPlan,
  computeCanvasGeometry,
  computeFitGeometry,
} from '../index.js';
import { makeImage, makeSite as makeFixture, timeAtSlot } from '../../../test-support/fixtures.js';

test('contain letterboxes a landscape image on a portrait display', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeFitGeometry(image, { width: 1080, height: 1920 }, 'contain', 0);
  assert.deepEqual(geometry.sourceRect, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(geometry.destinationRect.w, 1080);
  assert.equal(geometry.destinationRect.h, 607.5);
  assert.equal(geometry.destinationRect.x, 0);
  assert.equal(geometry.destinationRect.y, (1920 - 607.5) / 2);
  assert.equal(geometry.letterbox, true);
});

test('cover crops the source to the display aspect', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeFitGeometry(image, { width: 1080, height: 1920 }, 'cover', 0);
  assert.deepEqual(geometry.destinationRect, { x: 0, y: 0, w: 1080, h: 1920 });
  assert.equal(geometry.sourceRect.h, 1080);
  assert.equal(geometry.sourceRect.w, 607.5);
  assert.equal(geometry.sourceRect.x, (1920 - 607.5) / 2);
  assert.equal(geometry.sourceRect.y, 0);
});

test('stretch fills the display and keeps the whole source', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeFitGeometry(image, { width: 1000, height: 2000 }, 'stretch', 0);
  assert.deepEqual(geometry.sourceRect, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(geometry.destinationRect, { x: 0, y: 0, w: 1000, h: 2000 });
});

test('90-degree rotation swaps the contain destination aspect', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeFitGeometry(image, { width: 1080, height: 1920 }, 'contain', 90);
  assert.equal(geometry.destinationRect.w, 1080);
  assert.equal(geometry.destinationRect.h, 1920);
  assert.equal(geometry.rotation, 90);
});

test('90-degree cover crops for the pre-rotation target aspect', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeFitGeometry(image, { width: 1080, height: 1920 }, 'cover', 90);
  assert.equal(geometry.sourceRect.w, 1920);
  assert.equal(geometry.sourceRect.h, 1080);
  assert.deepEqual(geometry.destinationRect, { x: 0, y: 0, w: 1080, h: 1920 });
});

test('270-degree rotation stays inside the viewport', () => {
  const image = makeImage(0, { width: 1200, height: 1200 });
  const geometry = computeFitGeometry(image, { width: 1920, height: 1080 }, 'contain', 270);
  assert(geometry.destinationRect.x >= 0);
  assert(geometry.destinationRect.y >= 0);
  assert(geometry.destinationRect.x + geometry.destinationRect.w <= 1920.001);
  assert(geometry.destinationRect.y + geometry.destinationRect.h <= 1080.001);
});

test('unknown fit/rotation values normalize to safe defaults', () => {
  const image = makeImage(0);
  const geometry = computeFitGeometry(image, { width: 1920, height: 1080 }, 'nonsense', 45);
  assert.equal(geometry.fit, 'contain');
  assert.equal(geometry.rotation, 0);
  assert.throws(() => computeFitGeometry({ width: 0, height: 1080 }, { width: 1, height: 1 }));
  assert.throws(() => computeFitGeometry(image, { width: 0, height: 1 }));
});

test('canvas cover maps different slots to distinct source crops', () => {
  const image = makeImage(0, { width: 3840, height: 2160 });
  const layout = { canvasWidth: 3840, canvasHeight: 1440 };
  const left = computeCanvasGeometry(
    image,
    layout,
    { id: 'a', x: 0, y: 0, w: 1 / 3, h: 0.5 },
    { width: 1280, height: 720 },
    'cover',
    0,
  );
  const right = computeCanvasGeometry(
    image,
    layout,
    { id: 'b', x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    { width: 1280, height: 720 },
    'cover',
    0,
  );
  assert(left.sourceRect.x < right.sourceRect.x);
  assert(left.sourceRect.y < right.sourceRect.y);
  assert.equal(left.destinationRect.w, 1280);
  assert.equal(left.destinationRect.h, 720);
  assert.equal(left.destinationRect.x, 0);
});

test('canvas contain leaves letterbox areas out of the destination rect', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  const geometry = computeCanvasGeometry(
    image,
    { canvasWidth: 1000, canvasHeight: 2000 },
    { id: 'a', x: 0, y: 0, w: 1, h: 1 },
    { width: 1000, height: 2000 },
    'contain',
    0,
  );
  assert(geometry.destinationRect.h < 2000);
  assert.equal(geometry.destinationRect.w, 1000);
  assert.equal(geometry.sourceRect.w, 1920);
  assert.equal(geometry.letterbox, true);
});

test('render plan carries sourceRect, destinationRect, rotation, fit, transition and next change', () => {
  const { snapshot } = makeFixture({
    imageCount: 3,
    displayCount: 4,
    mode: 'synchronized-cycle',
    displayOptions: { portraitIndexes: [2], rotations: [0, 0, 0, 90] },
  });
  snapshot.playlist.items[2].fitMode = 'cover';
  snapshot.playlist.items[2].transitionMs = 700;
  const at = timeAtSlot(snapshot, 0);
  const plan = buildRenderPlan(snapshot, 'disp-3', at);
  assert.equal(plan.displayId, 'disp-3');
  assert.equal(plan.imageId, 'img-2');
  assert.equal(plan.rotation, 0);
  assert.equal(plan.fit, 'cover');
  assert.equal(plan.transitionMs, 700);
  assert(plan.sourceRect.w > 0);
  assert(plan.destinationRect.w > 0);
  assert.equal(new Date(plan.nextChangeAt).getTime(), plan.nextChangeAtMs);
  assert.equal(plan.slot, 0);
  assert.equal(plan.offsetMs, at - plan.slotStartMs);
  assert.equal(plan.imageIndex, 2);
  assert(plan.warnings.some((item) => item.code === 'ASPECT_MISMATCH'));

  const rotated = buildRenderPlan(snapshot, 'disp-4', at);
  assert.equal(rotated.rotation, 90);
  assert(rotated.destinationRect.w > 0);
});

test('canvas render plan exposes each display slot and crop', () => {
  const { snapshot } = makeFixture({ imageCount: 10, displayCount: 6, mode: 'canvas', layoutType: 'grid' });
  const at = timeAtSlot(snapshot, 0);
  const plans = snapshot.displays.map((display) => buildRenderPlan(snapshot, display.id, at));
  assert.equal(new Set(plans.map((plan) => plan.imageId)).size, 1);
  assert.equal(new Set(plans.map((plan) => plan.slotId)).size, 6);
  assert.equal(plans[0].sourceRect.x, 0);
  assert(plans[5].sourceRect.y > 0);
  assert(plans.every((plan) => plan.destinationRect.w > 0 && plan.destinationRect.h > 0));
});

test('placeholder plans remain usable when no content is published', () => {
  const { snapshot } = makeFixture({ imageCount: 0, displayCount: 4, mode: 'individual' });
  const plan = buildRenderPlan(snapshot, 'disp-1', timeAtSlot(snapshot, 0));
  assert.equal(plan.placeholder, true);
  assert.equal(plan.placeholderReason, 'no-images');
  assert.deepEqual(plan.destinationRect, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(plan.sourceRect, null);
});

test('unknown display throws a useful error', () => {
  const { snapshot } = makeFixture({ imageCount: 3, displayCount: 1 });
  assert.throws(() => buildRenderPlan(snapshot, 'nope', Date.now()), /Unknown display/);
});
