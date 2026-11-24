// SPDX-License-Identifier: Apache-2.0
import { buildLayout } from '../../packages/engine/index.js';
import {
  DEMO_IMAGE_SETS,
  DEMO_MEDIA,
  imageAssetFor,
  mediaById,
} from './demo-media.js';

function iso(ms) {
  return new Date(ms).toISOString();
}

function item(id, imageId, durationMs = 10_000) {
  return {
    id,
    imageId,
    durationMs,
    fitMode: undefined,
    transitionMs: 400,
    enabled: true,
  };
}

function imagesFor(ids) {
  return ids.map((id) => {
    const spec = mediaById(id);
    if (!spec) throw new Error(`Unknown demo media ${id}`);
    return imageAssetFor(spec);
  });
}

function display({ id, groupId, name, slotId, portrait = false, rotation = 0, status = 'online', lastSeen, startIndex = 0, step = 1 }) {
  return {
    id,
    groupId,
    name,
    slotId,
    hardwareId: `demo-${id}`,
    resolution: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
    orientation: portrait ? 'portrait' : 'landscape',
    rotation,
    capabilities: ['browser', 'offline-cache', 'video-none'],
    status,
    lastSeen,
    pairingState: 'paired',
    startIndex,
    step,
    fit: undefined,
  };
}

function customThreeByTwoLayout(id, name) {
  const gap = 0.012;
  const w = (1 - gap * 2) / 3;
  const h = (1 - gap) / 2;
  const slots = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const index = row * 3 + column;
      slots.push({
        id: `slot-${index + 1}`,
        x: Number((column * (w + gap)).toFixed(6)),
        y: Number((row * (h + gap)).toFixed(6)),
        w: Number(w.toFixed(6)),
        h: Number(h.toFixed(6)),
      });
    }
  }
  return {
    id,
    name,
    type: 'custom',
    canvasWidth: 3840,
    canvasHeight: 1440,
    slots,
    gap,
    bezel: 0,
  };
}

export function createDemoState(nowMs = Date.now()) {
  const epochMs = Math.floor(nowMs / 10_000) * 10_000 - 30_000;
  const epoch = iso(epochMs);
  const lastSeen = iso(nowMs);
  const staleSeen = iso(nowMs - 5 * 60_000);
  const createdAt = iso(nowMs);
  const imageSetThree = imagesFor(DEMO_IMAGE_SETS.three);
  const imageSetTen = imagesFor(DEMO_IMAGE_SETS.ten);
  const imageSetOne = imagesFor(DEMO_IMAGE_SETS.one);

  const siteA = {
    id: 'site-a',
    name: '국립부산국악원 A 인포메이션센터',
    timezone: 'Asia/Seoul',
    siteKey: 'demo-a',
    notes: 'PoC: 4 displays in a row, 3 images, synchronized-cycle.',
    groups: [
      {
        id: 'group-a-lobby',
        siteId: 'site-a',
        name: '로비 4면',
        layoutId: 'layout-a-row',
        playlistId: 'playlist-a',
        playbackMode: 'synchronized-cycle',
        epoch,
        settings: { dwellMs: 10_000, transitionMs: 400, fit: 'contain', startIndex: 0, step: 1 },
      },
    ],
    displays: [
      display({ id: 'disp-a1', groupId: 'group-a-lobby', name: 'A-01 가로', slotId: 'slot-1', status: 'online', lastSeen, startIndex: 0 }),
      display({ id: 'disp-a2', groupId: 'group-a-lobby', name: 'A-02 가로', slotId: 'slot-2', status: 'online', lastSeen, startIndex: 1 }),
      display({ id: 'disp-a3', groupId: 'group-a-lobby', name: 'A-03 세로', slotId: 'slot-3', portrait: true, status: 'online', lastSeen, startIndex: 2 }),
      display({ id: 'disp-a4', groupId: 'group-a-lobby', name: 'A-04 가로', slotId: 'slot-4', status: 'online', lastSeen, startIndex: 3 }),
    ],
    layouts: [buildLayout({ id: 'layout-a-row', name: '가로 4면', type: 'row', displayCount: 4, gap: 0.008 })],
    playlists: [
      {
        id: 'playlist-a',
        name: 'A 로비 3장',
        items: DEMO_IMAGE_SETS.three.map((imageId, index) => item(`a-item-${index + 1}`, imageId)),
      },
    ],
    images: imageSetThree,
    publication: {
      version: 3,
      siteId: 'site-a',
      epoch,
      publishedAt: iso(nowMs - 60_000),
      publishedBy: 'demo-seed',
    },
    createdAt,
    updatedAt: createdAt,
  };

  const siteB = {
    id: 'site-b',
    name: '국립부산국악원 B 안내 데스크',
    timezone: 'Asia/Seoul',
    siteKey: 'demo-b',
    notes: 'PoC: 1 display, 1 image, mirror mode.',
    groups: [
      {
        id: 'group-b-desk',
        siteId: 'site-b',
        name: '안내 1면',
        layoutId: 'layout-b-single',
        playlistId: 'playlist-b',
        playbackMode: 'mirror',
        epoch,
        settings: { dwellMs: 10_000, transitionMs: 300, fit: 'contain' },
      },
    ],
    displays: [
      display({ id: 'disp-b1', groupId: 'group-b-desk', name: 'B-01 가로', slotId: 'slot-1', status: 'online', lastSeen, startIndex: 0 }),
    ],
    layouts: [buildLayout({ id: 'layout-b-single', name: '1면', type: 'single', displayCount: 1 })],
    playlists: [
      {
        id: 'playlist-b',
        name: 'B 안내 1장',
        items: [item('b-item-1', DEMO_IMAGE_SETS.one[0], 10_000)],
      },
    ],
    images: imageSetOne,
    publication: {
      version: 2,
      siteId: 'site-b',
      epoch,
      publishedAt: iso(nowMs - 120_000),
      publishedBy: 'demo-seed',
    },
    createdAt,
    updatedAt: createdAt,
  };

  const siteC = {
    id: 'site-c',
    name: '국립부산국악원 C 통합 월',
    timezone: 'Asia/Seoul',
    siteKey: 'demo-c',
    notes: 'PoC: 6 displays in a custom 3x2 canvas, 10 images, one offline display.',
    groups: [
      {
        id: 'group-c-wall',
        siteId: 'site-c',
        name: 'C 통합 6면',
        layoutId: 'layout-c-custom',
        playlistId: 'playlist-c',
        playbackMode: 'canvas',
        epoch,
        settings: {
          dwellMs: 10_000,
          transitionMs: 500,
          fit: 'cover',
          canvasStartIndex: 0,
          canvasStep: 1,
        },
      },
    ],
    displays: [
      display({ id: 'disp-c1', groupId: 'group-c-wall', name: 'C-01', slotId: 'slot-1', status: 'online', lastSeen }),
      display({ id: 'disp-c2', groupId: 'group-c-wall', name: 'C-02', slotId: 'slot-2', status: 'online', lastSeen }),
      display({ id: 'disp-c3', groupId: 'group-c-wall', name: 'C-03', slotId: 'slot-3', status: 'online', lastSeen }),
      display({ id: 'disp-c4', groupId: 'group-c-wall', name: 'C-04', slotId: 'slot-4', status: 'offline', lastSeen: staleSeen }),
      display({ id: 'disp-c5', groupId: 'group-c-wall', name: 'C-05 (180도)', slotId: 'slot-5', rotation: 180, status: 'online', lastSeen }),
      display({ id: 'disp-c6', groupId: 'group-c-wall', name: 'C-06', slotId: 'slot-6', status: 'online', lastSeen }),
    ],
    layouts: [customThreeByTwoLayout('layout-c-custom', '사용자 지정 3x2')],
    playlists: [
      {
        id: 'playlist-c',
        name: 'C 통합 10장',
        items: DEMO_IMAGE_SETS.ten.map((imageId, index) => item(`c-item-${index + 1}`, imageId, 10_000)),
      },
    ],
    images: imageSetTen,
    publication: {
      version: 5,
      siteId: 'site-c',
      epoch,
      publishedAt: iso(nowMs - 180_000),
      publishedBy: 'demo-seed',
    },
    createdAt,
    updatedAt: createdAt,
  };

  const siteD = {
    id: 'site-d',
    name: '국립부산국악원 D 빈 콘텐츠 시험',
    timezone: 'Asia/Seoul',
    siteKey: 'demo-d',
    notes: 'PoC: 2 displays, 0 images, placeholder validation.',
    groups: [
      {
        id: 'group-d-empty',
        siteId: 'site-d',
        name: '빈 콘텐츠 2면',
        layoutId: 'layout-d-column',
        playlistId: 'playlist-d',
        playbackMode: 'individual',
        epoch,
        settings: { dwellMs: 10_000, transitionMs: 300, fit: 'contain' },
      },
    ],
    displays: [
      display({ id: 'disp-d1', groupId: 'group-d-empty', name: 'D-01', slotId: 'slot-1', status: 'online', lastSeen }),
      display({ id: 'disp-d2', groupId: 'group-d-empty', name: 'D-02', slotId: 'slot-2', status: 'online', lastSeen }),
    ],
    layouts: [buildLayout({ id: 'layout-d-column', name: '세로 2면', type: 'column', displayCount: 2 })],
    playlists: [{ id: 'playlist-d', name: 'D 빈 재생목록', items: [] }],
    images: [],
    publication: {
      version: 1,
      siteId: 'site-d',
      epoch,
      publishedAt: iso(nowMs - 240_000),
      publishedBy: 'demo-seed',
    },
    createdAt,
    updatedAt: createdAt,
  };

  return {
    schemaVersion: 1,
    seededAt: createdAt,
    updatedAt: createdAt,
    epoch,
    sites: [siteA, siteB, siteC, siteD],
  };
}

export function demoMediaCatalog() {
  return DEMO_MEDIA.map((spec) => imageAssetFor(spec));
}
