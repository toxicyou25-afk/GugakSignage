// SPDX-License-Identifier: Apache-2.0

/**
 * Convert the persisted wall snapshot into the exact input consumed by
 * buildRenderPlan. This module is shared by the Node preview and browser
 * player so timing and fit selection cannot drift between them.
 */
export function wallScreenInput(wall, displayId) {
  const screen = (wall?.screens ?? []).find((candidate) => candidate.displayId === displayId);
  const source = screen?.playlist ?? {
    id: `empty-${wall?.group?.id ?? 'unassigned'}`,
    name: 'No assignment',
    description: null,
    items: [],
  };
  const playable = source.items.filter(
    (item) =>
      item.enabled &&
      item.content?.url &&
      Number.isFinite(item.content.width) &&
      item.content.width > 0 &&
      Number.isFinite(item.content.height) &&
      item.content.height > 0,
  );
  return {
    site: {
      id: wall.site.id,
      name: wall.site.name,
      timezone: wall.site.timezone,
      notes: wall.site.notes,
      publication: { version: 0, epoch: wall.group.epoch },
    },
    group: {
      id: wall.group.id,
      siteId: wall.group.siteId,
      name: wall.group.name,
      layoutId: wall.group.layoutId,
      playlistId: screen?.playlistId ?? wall.group.playlistId,
      playbackMode: wall.group.playbackMode,
      epoch: wall.group.epoch,
      settings: wall.group.settings,
    },
    layout: wall.layout,
    playlist: {
      id: source.id,
      name: source.name,
      items: playable.map((item) => ({
        id: item.id,
        imageId: item.content.id,
        durationMs: Math.max(1, item.durationSeconds) * 1000,
        ...(item.fitMode ? { fitMode: item.fitMode } : {}),
        transitionMs: item.transitionMs,
        enabled: item.enabled,
      })),
    },
    images: playable.map((item) => ({
      id: item.content.id,
      filename: item.content.name,
      width: item.content.width,
      height: item.content.height,
      mime: item.content.mime || 'application/octet-stream',
      displayUrl: item.content.url,
    })),
    displays: wall.displays,
    mode: wall.group.playbackMode,
    epoch: wall.group.epoch,
    dwellMs: wall.dwellMs,
    settings: wall.group.settings,
  };
}
