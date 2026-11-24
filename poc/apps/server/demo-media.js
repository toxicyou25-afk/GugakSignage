// SPDX-License-Identifier: Apache-2.0
/**
 * Original vector demo assets. No third-party artwork, logos, or fonts are
 * bundled; the browser's local Korean sans-serif font is used.
 */
export const DEMO_MEDIA = [
  {
    id: 'asset-welcome',
    filename: 'welcome.svg',
    width: 1920,
    height: 1080,
    title: '환영합니다',
    subtitle: '국립부산국악원 인포메이션센터',
    kicker: 'GUGANG SIGN · WELCOME',
    numeral: '01',
    theme: 'navy',
  },
  {
    id: 'asset-performance',
    filename: 'performance.svg',
    width: 1200,
    height: 1200,
    title: '오늘의 공연',
    subtitle: '국악의 울림, 부산에서 만나다',
    kicker: 'GUGANG SIGN · PROGRAM',
    numeral: '02',
    theme: 'celadon',
  },
  {
    id: 'asset-hours',
    filename: 'hours.svg',
    width: 1080,
    height: 1920,
    title: '운영 시간',
    subtitle: '09:00 — 18:00\n월요일 휴관',
    kicker: 'GUGANG SIGN · HOURS',
    numeral: '03',
    theme: 'hanji',
  },
  {
    id: 'asset-notice',
    filename: 'notice.svg',
    width: 1920,
    height: 1080,
    title: '안내',
    subtitle: '궁금한 점은 가까운 직원에게 문의해 주세요.',
    kicker: 'GUGANG SIGN · NOTICE',
    numeral: '04',
    theme: 'vermilion',
  },
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `asset-canvas-${String(index + 1).padStart(2, '0')}`,
    filename: `canvas-${String(index + 1).padStart(2, '0')}.svg`,
    width: 3840,
    height: 2160,
    title: ['소리', '가락', '장단', '울림', '한지', '청자'][index % 6],
    subtitle: `통합 화면 이미지 ${String(index + 1).padStart(2, '0')} · 원본 데모 자산`,
    kicker: `GUGANG SIGN · CANVAS ${String(index + 1).padStart(2, '0')}`,
    numeral: String(index + 1).padStart(2, '0'),
    theme: ['navy', 'celadon', 'hanji', 'vermilion'][index % 4],
  })),
];

export const DEMO_IMAGE_SETS = Object.freeze({
  zero: [],
  one: ['asset-notice'],
  three: ['asset-welcome', 'asset-performance', 'asset-hours'],
  ten: Array.from({ length: 10 }, (_, index) => `asset-canvas-${String(index + 1).padStart(2, '0')}`),
});

export function mediaById(id) {
  return DEMO_MEDIA.find((item) => item.id === id) ?? null;
}

export function imageAssetFor(spec, baseUrl = '/media') {
  return {
    id: spec.id,
    filename: spec.filename,
    width: spec.width,
    height: spec.height,
    aspectRatio: Number((spec.width / spec.height).toFixed(4)),
    mime: 'image/svg+xml',
    size: 12000 + spec.filename.length * 31,
    checksum: `demo-${spec.id}`,
    displayUrl: `${baseUrl}/${spec.filename}`,
    thumbnailUrl: `${baseUrl}/${spec.filename}`,
    createdAt: '2026-11-24T08:00:00.000Z',
  };
}
