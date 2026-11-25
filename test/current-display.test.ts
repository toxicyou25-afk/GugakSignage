/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activePlaylistForNow,
  broadcastFromPlaylist,
  parsePlayingContentId,
  shouldShowSampleBanner,
  snapshotHasUserContent,
} from '../src/current-display.js';
import type { ManifestPlaylist, ManifestSchedule } from '../src/types.js';

const userPlaylist: ManifestPlaylist = {
  id: 'pl-user',
  name: '사용자 재생목록',
  description: null,
  items: [
    {
      id: 'item-1',
      position: 1,
      durationSeconds: 12,
      fitMode: 'cover',
      transitionMs: 400,
      enabled: true,
      content: {
        id: 'ct-user-image',
        name: '사용자 포스터',
        kind: 'image',
        mime: 'image/png',
        url: '/media/user.png',
        width: 1920,
        height: 1080,
      },
    },
    {
      id: 'item-2',
      position: 2,
      durationSeconds: 5,
      transitionMs: 300,
      enabled: false,
      content: {
        id: 'ct-disabled',
        name: '꺼진 항목',
        kind: 'image',
        mime: 'image/png',
        url: '/media/off.png',
        width: 1920,
        height: 1080,
      },
    },
  ],
};

const samplePlaylist: ManifestPlaylist = {
  id: 'pl-sample',
  name: '로비 기본 순환',
  description: null,
  items: [{
    id: 'sample-item',
    position: 1,
    durationSeconds: 10,
    transitionMs: 500,
    enabled: true,
    content: {
      id: 'ct-sample-poster',
      name: '가을 국악 한마당 포스터',
      kind: 'image',
      mime: 'image/png',
      url: '/media/poster.png',
      width: 1920,
      height: 1080,
    },
  }],
};

test('playing:<contentId>만 현재 항목으로 해석한다', () => {
  assert.equal(parsePlayingContentId('playing:ct-user-image'), 'ct-user-image');
  assert.equal(parsePlayingContentId('paused:ct-user-image'), null);
  assert.equal(parsePlayingContentId('playing:'), null);
  assert.equal(parsePlayingContentId(null), null);
});

test('현재 시각에 맞는 예약 재생목록을 고르고 자정 넘김을 처리한다', () => {
  const schedules: ManifestSchedule[] = [{
    id: 'schedule-1',
    days: [1],
    startTime: '22:00',
    endTime: '02:00',
    enabled: true,
    playlist: userPlaylist,
  }];
  assert.equal(activePlaylistForNow(samplePlaylist, schedules, new Date('2026-11-23T23:30:00')).id, 'pl-user');
  assert.equal(activePlaylistForNow(samplePlaylist, schedules, new Date('2026-11-24T01:30:00')).id, 'pl-user');
  assert.equal(activePlaylistForNow(samplePlaylist, schedules, new Date('2026-11-24T03:00:00')).id, 'pl-sample');
});

test('게시 재생목록 항목은 활성 항목만 순서·표시 시간·fit과 함께 만든다', () => {
  const snapshot = broadcastFromPlaylist(userPlaylist, 'published');
  assert.equal(snapshot.source, 'published');
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0]!.position, 1);
  assert.equal(snapshot.items[0]!.durationSeconds, 12);
  assert.equal(snapshot.items[0]!.fitMode, 'cover');
  assert.equal(snapshot.items[0]!.content.name, '사용자 포스터');
  assert.equal(snapshot.items[0]!.playlistName, '사용자 재생목록');
  assert.equal(snapshot.sampleOnly, false);
});

test('사용자 콘텐츠나 사용자 게시가 없으면 샘플 배너를 표시한다', () => {
  assert.equal(shouldShowSampleBanner(), true);
  assert.equal(shouldShowSampleBanner({ hasUserContents: false, hasUserPublication: false }), true);
  assert.equal(shouldShowSampleBanner({ hasUserContents: true, hasUserPublication: false }), true);
  assert.equal(shouldShowSampleBanner({ hasUserContents: false, hasUserPublication: true }), true);
  assert.equal(shouldShowSampleBanner({ hasUserContents: true, hasUserPublication: true }), false);
  assert.equal(snapshotHasUserContent({ defaultPlaylist: samplePlaylist, schedules: [] }), false);
  assert.equal(snapshotHasUserContent({ defaultPlaylist: samplePlaylist, schedules: [{ playlist: userPlaylist }] }), true);
});
