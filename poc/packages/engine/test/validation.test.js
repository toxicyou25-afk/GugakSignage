// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectDifference,
  buildLayout,
  summarizeIssues,
  validateImageAsset,
  validateImageCounts,
  validateImageFit,
  validateLayout,
  validatePublication,
  validateSite,
  validateSnapshot,
} from '../index.js';
import { FIXTURE_EPOCH, makeImage, makeSite } from '../../../test-support/fixtures.js';

test('valid demo-shaped site has no errors', () => {
  const { site } = makeSite({ imageCount: 3, displayCount: 4 });
  const issues = validateSite(site);
  assert.equal(summarizeIssues(issues).errors, 0);
});

test('image validation rejects bad dimensions, MIME, and URL', () => {
  const issues = validateImageAsset({
    id: 'bad',
    filename: 'bad.exe',
    width: 0,
    height: -2,
    mime: 'application/octet-stream',
    displayUrl: '',
  });
  const codes = new Set(issues.map((item) => item.code));
  assert(codes.has('IMAGE_WIDTH_INVALID'));
  assert(codes.has('IMAGE_HEIGHT_INVALID'));
  assert(codes.has('IMAGE_MIME_UNSUPPORTED'));
  assert(codes.has('IMAGE_URL_REQUIRED'));
});

test('aspect mismatch warns above 10 percent and stretch adds a distortion warning', () => {
  const portrait = makeImage(0, { width: 1080, height: 1920 });
  const viewport = { width: 1920, height: 1080 };
  assert(aspectDifference(portrait, viewport) > 0.1);
  const contain = validateImageFit(portrait, viewport, 'contain');
  assert.equal(contain.filter((item) => item.code === 'ASPECT_MISMATCH').length, 1);
  assert.equal(contain.filter((item) => item.code === 'STRETCH_DISTORTS').length, 0);
  const stretch = validateImageFit(portrait, viewport, 'stretch');
  assert(stretch.some((item) => item.code === 'STRETCH_DISTORTS'));
});

test('near-matching aspect ratios do not warn', () => {
  const image = makeImage(0, { width: 1920, height: 1080 });
  assert.deepEqual(validateImageFit(image, { width: 1920, height: 1080 }), []);
  const issues = validateImageFit(image, { width: 1900, height: 1100 });
  assert.equal(issues.filter((item) => item.code === 'ASPECT_MISMATCH').length, 0);
});

test('layout validation catches out-of-bounds and overlapping slots', () => {
  const layout = buildLayout({
    type: 'custom',
    displayCount: 2,
    slots: [
      { id: 'a', x: 0, y: 0, w: 0.7, h: 0.7 },
      { id: 'b', x: 0.5, y: 0.5, w: 0.7, h: 0.7 },
    ],
  });
  const issues = validateLayout(layout);
  assert(issues.some((item) => item.code === 'LAYOUT_SLOT_OVERLAP'));
  assert(issues.some((item) => item.code === 'LAYOUT_SLOT_OUT_OF_BOUNDS'));
});

test('layout validation catches duplicate and missing slot ids', () => {
  const layout = {
    id: 'x',
    type: 'custom',
    canvasWidth: 100,
    canvasHeight: 100,
    slots: [
      { id: 'same', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: 'same', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: '', x: 0, y: 0.5, w: 0.5, h: 0.5 },
    ],
  };
  const codes = validateLayout(layout).map((item) => item.code);
  assert(codes.includes('LAYOUT_SLOT_ID_DUPLICATE'));
  assert(codes.includes('LAYOUT_SLOT_ID_REQUIRED'));
});

test('image count rules cover 0, 1, N<M, N=M, N>M', () => {
  const codes = (n, m) => new Set(validateImageCounts(n, m).map((item) => item.code));
  assert(codes(0, 4).has('NO_IMAGES'));
  assert(codes(1, 4).has('SINGLE_IMAGE'));
  assert(codes(3, 4).has('FEWER_IMAGES_THAN_DISPLAYS'));
  assert(!codes(4, 4).has('FEWER_IMAGES_THAN_DISPLAYS'));
  assert(!codes(4, 4).has('MORE_IMAGES_THAN_DISPLAYS'));
  assert(codes(10, 4).has('MORE_IMAGES_THAN_DISPLAYS'));
  assert(codes(3, 0).has('NO_DISPLAYS'));
});

test('snapshot validation warns for fewer images and offline displays', () => {
  const { snapshot } = makeSite({
    imageCount: 3,
    displayCount: 4,
    displayOptions: { statuses: ['online', 'online', 'offline', 'online'] },
  });
  const issues = validateSnapshot(snapshot);
  assert(issues.some((item) => item.code === 'FEWER_IMAGES_THAN_DISPLAYS'));
  assert(issues.some((item) => item.code === 'DISPLAY_OFFLINE'));
});

test('publication validation checks version, site, and epoch', () => {
  assert.deepEqual(validatePublication({ version: 1, siteId: 'a', epoch: new Date(FIXTURE_EPOCH).toISOString() }), []);
  const codes = validatePublication({ version: 0, siteId: '', epoch: 'not-a-date' }).map((item) => item.code);
  assert(codes.includes('PUBLICATION_VERSION_INVALID'));
  assert(codes.includes('PUBLICATION_EPOCH_INVALID'));
  assert(codes.includes('PUBLICATION_SITE_REQUIRED'));
});

test('site validation detects broken group references', () => {
  const { site } = makeSite();
  site.groups[0].layoutId = 'missing-layout';
  site.groups[0].playlistId = 'missing-playlist';
  const codes = validateSite(site).map((item) => item.code);
  assert(codes.includes('GROUP_LAYOUT_MISSING'));
  assert(codes.includes('GROUP_PLAYLIST_MISSING'));
});
