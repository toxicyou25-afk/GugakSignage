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
  const playable = source.items.filter((item) => {
    const content = item.enabled ? item.content : null;
    if (!content?.url) return false;
    if (content.kind === 'url') return true;
    return (
      Number.isFinite(content.width) &&
      content.width > 0 &&
      Number.isFinite(content.height) &&
      content.height > 0
    );
  });
  const contents = playable.map((item) => ({
    id: item.content.id,
    name: item.content.name,
    kind: item.content.kind ?? 'image',
    mime: item.content.mime || null,
    url: item.content.url,
    width: item.content.width,
    height: item.content.height,
  }));
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
        contentId: item.content.id,
        kind: item.content.kind ?? 'image',
        contentUrl: item.content.url,
        durationMs: Math.max(1, item.durationSeconds) * 1000,
        ...(item.fitMode ? { fitMode: item.fitMode } : {}),
        transitionMs: item.transitionMs,
        enabled: item.enabled,
      })),
    },
    contents,
    images: contents
      .filter((content) => content.kind !== 'url')
      .map((content) => ({
        ...content,
        filename: content.name,
        displayUrl: content.url,
      })),
    displays: wall.displays,
    mode: wall.group.playbackMode,
    epoch: wall.group.epoch,
    dwellMs: wall.dwellMs,
    settings: wall.group.settings,
  };
}
