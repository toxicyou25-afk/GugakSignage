// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRenderPlan, wallScreenInput } from '../index.js';

const epoch = '2026-11-24T09:00:00.000Z';
const epochMs = Date.parse(epoch);
const contents = [
  { id: 'image-a', name: 'Image A', kind: 'image', mime: 'image/png', url: '/media/a.png', width: 1920, height: 1080 },
  { id: 'video-b', name: 'Video B', kind: 'video', mime: 'video/mp4', url: '/media/b.mp4', width: 640, height: 360 },
  { id: 'image-c', name: 'Image C', kind: 'image', mime: 'image/png', url: '/media/c.png', width: 1080, height: 1920 },
  { id: 'image-d', name: 'Image D', kind: 'image', mime: 'image/png', url: '/media/d.png', width: 1920, height: 1080 },
  { id: 'url-e', name: 'Notice E', kind: 'url', mime: null, url: '/sample/notice.html', width: null, height: null },
];

function makeWall({ onlyUrl = false } = {}) {
  const selected = onlyUrl ? contents.filter((content) => content.kind === 'url') : contents;
  const items = selected.map((content, index) => ({
    id: `item-${index}`,
    position: index + 1,
    durationSeconds: 10,
    fitMode: 'contain',
    transitionMs: 300 + index,
    enabled: true,
    content,
  }));
  const playlist = { id: 'playlist-mixed', name: 'Mixed playlist', description: null, items };
  const displays = Array.from({ length: onlyUrl ? 1 : 4 }, (_, index) => ({
    id: `display-${index + 1}`,
    deviceId: index < 2 ? 'pc-a' : 'pc-b',
    groupId: 'group-1',
    name: `Display ${index + 1}`,
    resolution: { width: 1920, height: 1080 },
    orientation: 'landscape',
    rotation: 0,
    fit: 'contain',
    slotId: `slot-${index + 1}`,
    startIndex: index,
    step: 1,
    status: 'online',
  }));
  return {
    schemaVersion: 2,
    publishedAt: null,
    site: { id: 'site-1', name: 'Site', timezone: 'Asia/Seoul', notes: null },
    group: {
      id: 'group-1',
      siteId: 'site-1',
      name: 'Group',
      layoutId: 'layout-1',
      playlistId: playlist.id,
      playbackMode: 'individual',
      epoch,
      settings: { dwellMs: 10_000, transitionMs: 300 },
    },
    layout: {
      id: 'layout-1',
      name: 'Row',
      type: 'row',
      canvasWidth: displays.length * 1920,
      canvasHeight: 1080,
      gap: 0,
      bezel: 0,
      slots: displays.map((display, index) => ({
        id: `slot-${index + 1}`,
        x: index / displays.length,
        y: 0,
        w: 1 / displays.length,
        h: 1,
      })),
    },
    displays,
    screens: displays.map((display) => ({ displayId: display.id, playlistId: playlist.id, playlist })),
    groupPlaylist: playlist,
    dwellMs: 10_000,
  };
}

test('wall input preserves image, video, and URL items and schedules URL transitions', () => {
  const wall = makeWall();
  const input = wallScreenInput(wall, 'display-1');

  assert.equal(input.playlist.items.length, 5);
  assert.equal(input.contents.length, 5);
  assert.equal(input.images.length, 4);
  assert.deepEqual(input.playlist.items.map((item) => item.kind), ['image', 'video', 'image', 'image', 'url']);
  assert.deepEqual(input.contents.find((content) => content.kind === 'url'), {
    id: 'url-e',
    name: 'Notice E',
    kind: 'url',
    mime: null,
    url: '/sample/notice.html',
    width: null,
    height: null,
  });

  const atStart = wall.displays.map((display) => buildRenderPlan(input, display.id, epochMs + 500));
  assert.deepEqual(atStart.map((plan) => plan.kind), ['image', 'video', 'image', 'image']);
  const urlPlan = buildRenderPlan(input, 'display-1', epochMs + 40_500);
  assert.equal(urlPlan.kind, 'url');
  assert.equal(urlPlan.contentId, 'url-e');
  assert.equal(urlPlan.contentUrl, '/sample/notice.html');
  assert.equal(urlPlan.requiresNetwork, true);
  assert.equal(urlPlan.transitionMs, 304);
  assert.equal(urlPlan.nextChangeAtMs, epochMs + 50_000);
  assert.equal(urlPlan.placeholder, false);
  assert.equal(urlPlan.sourceRect, null);
  assert.deepEqual(urlPlan.destinationRect, { x: 0, y: 0, w: 1920, h: 1080 });
});

test('a URL-only wall item produces a visible static RenderPlan', () => {
  const wall = makeWall({ onlyUrl: true });
  const input = wallScreenInput(wall, 'display-1');
  const plan = buildRenderPlan(input, 'display-1', epochMs);

  assert.equal(input.playlist.items.length, 1);
  assert.equal(plan.kind, 'url');
  assert.equal(plan.placeholder, false);
  assert.equal(plan.static, true);
  assert.equal(plan.nextChangeAtMs, null);
  assert.equal(plan.contentUrl, '/sample/notice.html');
  assert.equal(plan.image, null);
});
