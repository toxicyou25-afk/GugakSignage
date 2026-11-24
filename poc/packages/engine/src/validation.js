// SPDX-License-Identifier: Apache-2.0
import {
  DEFAULT_ASPECT_TOLERANCE,
  FIT_MODES,
  IMAGE_MIME_TYPES,
  LAYOUT_TYPES,
  ORIENTATIONS,
  PLAYBACK_MODES,
  ROTATIONS,
  isFiniteNumber,
} from '../types.js';

function issue(code, severity, path, message, details) {
  const item = { code, severity, path, message };
  if (details !== undefined) item.details = details;
  return item;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

function isRect(value) {
  return (
    isObject(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.w) &&
    isFiniteNumber(value.h) &&
    value.w > 0 &&
    value.h > 0
  );
}

function isDateString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function aspectRatioOfSize(width, height) {
  return isFiniteNumber(width) && isFiniteNumber(height) && width > 0 && height > 0
    ? width / height
    : 0;
}

export function aspectDifference(image, viewport) {
  const imageAspect = aspectRatioOfSize(image?.width, image?.height);
  const targetAspect = aspectRatioOfSize(viewport?.width, viewport?.height);
  if (!imageAspect || !targetAspect) return Infinity;
  return Math.abs(imageAspect - targetAspect) / targetAspect;
}

export function validateImageAsset(image, options = {}) {
  const issues = [];
  const path = options.path ?? 'image';
  if (!isObject(image)) {
    return [issue('INVALID_IMAGE', 'error', path, 'Image asset must be an object.')];
  }
  if (typeof image.id !== 'string' || image.id.trim() === '') {
    issues.push(issue('IMAGE_ID_REQUIRED', 'error', `${path}.id`, 'Image id is required.'));
  }
  if (typeof image.filename !== 'string' || image.filename.trim() === '') {
    issues.push(issue('IMAGE_FILENAME_REQUIRED', 'error', `${path}.filename`, 'Image filename is required.'));
  }
  if (!isPositiveInt(image.width)) {
    issues.push(issue('IMAGE_WIDTH_INVALID', 'error', `${path}.width`, 'Image width must be a positive integer.'));
  }
  if (!isPositiveInt(image.height)) {
    issues.push(issue('IMAGE_HEIGHT_INVALID', 'error', `${path}.height`, 'Image height must be a positive integer.'));
  }
  if (image.width > 16384 || image.height > 16384) {
    issues.push(issue('IMAGE_DIMENSIONS_LARGE', 'warning', `${path}.width`, 'Image exceeds the PoC 16384px limit.'));
  }
  if (typeof image.mime !== 'string' || !IMAGE_MIME_TYPES.includes(image.mime)) {
    issues.push(
      issue('IMAGE_MIME_UNSUPPORTED', 'error', `${path}.mime`, `Supported image types are ${IMAGE_MIME_TYPES.join(', ')}.`),
    );
  }
  if (typeof image.displayUrl !== 'string' || image.displayUrl.trim() === '') {
    issues.push(issue('IMAGE_URL_REQUIRED', 'error', `${path}.displayUrl`, 'A display URL is required.'));
  }
  if (image.size !== undefined && !isNonNegativeNumber(image.size)) {
    issues.push(issue('IMAGE_SIZE_INVALID', 'error', `${path}.size`, 'Image size must be a non-negative number.'));
  }
  if (image.size !== undefined && image.size > 25 * 1024 * 1024) {
    issues.push(issue('IMAGE_SIZE_LARGE', 'warning', `${path}.size`, 'Image exceeds the PoC 25 MB soft limit.'));
  }
  if (image.aspectRatio !== undefined) {
    const expected = aspectRatioOfSize(image.width, image.height);
    if (!isFiniteNumber(image.aspectRatio) || Math.abs(image.aspectRatio - expected) > 0.01) {
      issues.push(
        issue('IMAGE_ASPECT_INCONSISTENT', 'warning', `${path}.aspectRatio`, 'Declared aspect ratio does not match image dimensions.'),
      );
    }
  }
  return issues;
}

export function validateImageFit(image, viewport, fit = 'contain', options = {}) {
  const issues = [];
  const path = options.path ?? 'image';
  const tolerance = options.tolerance ?? DEFAULT_ASPECT_TOLERANCE;
  if (!FIT_MODES.includes(fit)) {
    issues.push(issue('FIT_MODE_INVALID', 'error', `${path}.fit`, `Fit must be one of ${FIT_MODES.join(', ')}.`));
  }
  const difference = aspectDifference(image, viewport);
  if (Number.isFinite(difference) && difference > tolerance) {
    issues.push(
      issue(
        'ASPECT_MISMATCH',
        'warning',
        path,
        `Image aspect differs from the ${viewport.width}x${viewport.height} display by ${(difference * 100).toFixed(1)}%.`,
        { imageId: image?.id, imageAspect: image.width / image.height, targetAspect: viewport.width / viewport.height, difference },
      ),
    );
    if (fit === 'stretch') {
      issues.push(
        issue('STRETCH_DISTORTS', 'warning', `${path}.fit`, 'Stretch will distort this image on this display; use contain or cover.', {
          imageId: image?.id,
        }),
      );
    }
  }
  return issues;
}

export function validateDisplay(display, options = {}) {
  const issues = [];
  const path = options.path ?? 'display';
  if (!isObject(display)) return [issue('INVALID_DISPLAY', 'error', path, 'Display must be an object.')];
  if (typeof display.id !== 'string' || display.id.trim() === '') {
    issues.push(issue('DISPLAY_ID_REQUIRED', 'error', `${path}.id`, 'Display id is required.'));
  }
  if (typeof display.name !== 'string' || display.name.trim() === '') {
    issues.push(issue('DISPLAY_NAME_REQUIRED', 'warning', `${path}.name`, 'Display name is empty.'));
  }
  if (typeof display.groupId !== 'string' || display.groupId.trim() === '') {
    issues.push(issue('DISPLAY_GROUP_REQUIRED', 'error', `${path}.groupId`, 'Display groupId is required.'));
  }
  if (!isObject(display.resolution) || !isPositiveInt(display.resolution.width) || !isPositiveInt(display.resolution.height)) {
    issues.push(issue('DISPLAY_RESOLUTION_INVALID', 'error', `${path}.resolution`, 'Resolution width/height must be positive integers.'));
  } else {
    const actualOrientation = display.resolution.width >= display.resolution.height ? 'landscape' : 'portrait';
    if (!ORIENTATIONS.includes(display.orientation)) {
      issues.push(issue('DISPLAY_ORIENTATION_INVALID', 'error', `${path}.orientation`, 'Orientation must be landscape or portrait.'));
    } else if (display.orientation !== actualOrientation) {
      issues.push(
        issue(
          'DISPLAY_ORIENTATION_MISMATCH',
          'warning',
          `${path}.orientation`,
          `Orientation ${display.orientation} does not match ${display.resolution.width}x${display.resolution.height}.`,
        ),
      );
    }
  }
  if (display.rotation !== undefined && !ROTATIONS.includes(display.rotation)) {
    issues.push(issue('DISPLAY_ROTATION_INVALID', 'error', `${path}.rotation`, 'Rotation must be 0, 90, 180, or 270.'));
  }
  if (display.fit !== undefined && !FIT_MODES.includes(display.fit)) {
    issues.push(issue('DISPLAY_FIT_INVALID', 'error', `${path}.fit`, `Fit must be one of ${FIT_MODES.join(', ')}.`));
  }
  if (display.startIndex !== undefined && (!Number.isInteger(display.startIndex) || display.startIndex < 0)) {
    issues.push(issue('DISPLAY_START_INDEX_INVALID', 'error', `${path}.startIndex`, 'startIndex must be a non-negative integer.'));
  }
  if (display.step !== undefined && !Number.isInteger(display.step)) {
    issues.push(issue('DISPLAY_STEP_INVALID', 'error', `${path}.step`, 'step must be an integer.'));
  }
  if (display.startOffsetMs !== undefined && !isFiniteNumber(display.startOffsetMs)) {
    issues.push(issue('DISPLAY_OFFSET_INVALID', 'error', `${path}.startOffsetMs`, 'startOffsetMs must be a finite number.'));
  }
  return issues;
}

export function validateLayout(layout, options = {}) {
  const issues = [];
  const path = options.path ?? 'layout';
  if (!isObject(layout)) return [issue('INVALID_LAYOUT', 'error', path, 'Layout must be an object.')];
  if (typeof layout.id !== 'string' || layout.id.trim() === '') {
    issues.push(issue('LAYOUT_ID_REQUIRED', 'error', `${path}.id`, 'Layout id is required.'));
  }
  if (!LAYOUT_TYPES.includes(layout.type)) {
    issues.push(issue('LAYOUT_TYPE_INVALID', 'error', `${path}.type`, `Layout type must be one of ${LAYOUT_TYPES.join(', ')}.`));
  }
  if (!isPositiveInt(layout.canvasWidth) || !isPositiveInt(layout.canvasHeight)) {
    issues.push(issue('LAYOUT_CANVAS_INVALID', 'error', `${path}.canvas`, 'Canvas width/height must be positive integers.'));
  }
  if (!Array.isArray(layout.slots) || layout.slots.length === 0) {
    issues.push(issue('LAYOUT_SLOTS_REQUIRED', 'error', `${path}.slots`, 'Layout must contain at least one slot.'));
    return issues;
  }

  const ids = new Set();
  layout.slots.forEach((slot, index) => {
    const slotPath = `${path}.slots[${index}]`;
    if (!isObject(slot)) {
      issues.push(issue('LAYOUT_SLOT_INVALID', 'error', slotPath, 'Slot must be an object.'));
      return;
    }
    if (typeof slot.id !== 'string' || slot.id.trim() === '') {
      issues.push(issue('LAYOUT_SLOT_ID_REQUIRED', 'error', `${slotPath}.id`, 'Slot id is required.'));
    } else if (ids.has(slot.id)) {
      issues.push(issue('LAYOUT_SLOT_ID_DUPLICATE', 'error', `${slotPath}.id`, `Duplicate slot id ${slot.id}.`));
    } else {
      ids.add(slot.id);
    }
    if (!isRect(slot)) {
      issues.push(issue('LAYOUT_SLOT_RECT_INVALID', 'error', slotPath, 'Slot x/y/w/h must be finite and w/h positive.'));
      return;
    }
    if (slot.x < 0 || slot.y < 0 || slot.x + slot.w > 1.000001 || slot.y + slot.h > 1.000001) {
      issues.push(issue('LAYOUT_SLOT_OUT_OF_BOUNDS', 'warning', slotPath, 'Slot extends outside the normalized canvas.'));
    }
    if (slot.rotation !== undefined && !ROTATIONS.includes(slot.rotation)) {
      issues.push(issue('LAYOUT_SLOT_ROTATION_INVALID', 'error', `${slotPath}.rotation`, 'Slot rotation must be 0, 90, 180, or 270.'));
    }
  });

  const slots = layout.slots.filter((slot) => isObject(slot) && isRect(slot));
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i];
      const b = slots[j];
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapW > 0.0001 && overlapH > 0.0001) {
        issues.push(
          issue('LAYOUT_SLOT_OVERLAP', 'warning', `${path}.slots[${i}]`, `Slots ${a.id ?? i} and ${b.id ?? j} overlap.`, {
            a: a.id,
            b: b.id,
            area: overlapW * overlapH,
          }),
        );
      }
    }
  }

  const gap = layout.gap ?? 0;
  if (!isNonNegativeNumber(gap) || gap > 0.25) {
    issues.push(issue('LAYOUT_GAP_INVALID', 'warning', `${path}.gap`, 'Gap must be between 0 and 0.25 of the canvas.'));
  }
  return issues;
}

export function validatePlaylist(playlist, options = {}) {
  const issues = [];
  const path = options.path ?? 'playlist';
  const imageIds = options.imageIds ? new Set(options.imageIds) : null;
  if (!isObject(playlist)) return [issue('INVALID_PLAYLIST', 'error', path, 'Playlist must be an object.')];
  if (typeof playlist.id !== 'string' || playlist.id.trim() === '') {
    issues.push(issue('PLAYLIST_ID_REQUIRED', 'error', `${path}.id`, 'Playlist id is required.'));
  }
  if (!Array.isArray(playlist.items)) {
    issues.push(issue('PLAYLIST_ITEMS_REQUIRED', 'error', `${path}.items`, 'Playlist items must be an array.'));
    return issues;
  }
  const itemIds = new Set();
  playlist.items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isObject(item)) {
      issues.push(issue('PLAYLIST_ITEM_INVALID', 'error', itemPath, 'Playlist item must be an object.'));
      return;
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      issues.push(issue('PLAYLIST_ITEM_ID_REQUIRED', 'error', `${itemPath}.id`, 'Playlist item id is required.'));
    } else if (itemIds.has(item.id)) {
      issues.push(issue('PLAYLIST_ITEM_ID_DUPLICATE', 'error', `${itemPath}.id`, `Duplicate playlist item id ${item.id}.`));
    } else {
      itemIds.add(item.id);
    }
    if (typeof item.imageId !== 'string' || item.imageId.trim() === '') {
      issues.push(issue('PLAYLIST_IMAGE_REQUIRED', 'error', `${itemPath}.imageId`, 'Playlist item imageId is required.'));
    } else if (imageIds && !imageIds.has(item.imageId)) {
      issues.push(issue('PLAYLIST_IMAGE_MISSING', 'error', `${itemPath}.imageId`, `Image ${item.imageId} does not exist.`));
    }
    if (!isFiniteNumber(item.durationMs) || item.durationMs <= 0) {
      issues.push(issue('PLAYLIST_DURATION_INVALID', 'error', `${itemPath}.durationMs`, 'Duration must be greater than zero.'));
    }
    if (item.fitMode !== undefined && !FIT_MODES.includes(item.fitMode)) {
      issues.push(issue('PLAYLIST_FIT_INVALID', 'error', `${itemPath}.fitMode`, `Fit must be one of ${FIT_MODES.join(', ')}.`));
    }
    if (item.transitionMs !== undefined && !isNonNegativeNumber(item.transitionMs)) {
      issues.push(issue('PLAYLIST_TRANSITION_INVALID', 'error', `${itemPath}.transitionMs`, 'Transition must be non-negative.'));
    }
  });
  return issues;
}

export function validateDisplayGroup(group, options = {}) {
  const issues = [];
  const path = options.path ?? 'group';
  if (!isObject(group)) return [issue('INVALID_GROUP', 'error', path, 'Display group must be an object.')];
  for (const key of ['id', 'siteId', 'name', 'layoutId', 'playlistId']) {
    if (typeof group[key] !== 'string' || group[key].trim() === '') {
      issues.push(issue('GROUP_FIELD_REQUIRED', 'error', `${path}.${key}`, `Group ${key} is required.`));
    }
  }
  if (!PLAYBACK_MODES.includes(group.playbackMode)) {
    issues.push(issue('GROUP_MODE_INVALID', 'error', `${path}.playbackMode`, `Playback mode must be one of ${PLAYBACK_MODES.join(', ')}.`));
  }
  if (!isDateString(group.epoch)) {
    issues.push(issue('GROUP_EPOCH_INVALID', 'error', `${path}.epoch`, 'Group epoch must be an ISO date string.'));
  }
  if (group.settings !== undefined && !isObject(group.settings)) {
    issues.push(issue('GROUP_SETTINGS_INVALID', 'error', `${path}.settings`, 'Group settings must be an object.'));
  }
  return issues;
}

export function validatePublication(publication, options = {}) {
  const issues = [];
  const path = options.path ?? 'publication';
  if (!isObject(publication)) return [issue('INVALID_PUBLICATION', 'error', path, 'Publication must be an object.')];
  if (!Number.isInteger(publication.version) || publication.version < 1) {
    issues.push(issue('PUBLICATION_VERSION_INVALID', 'error', `${path}.version`, 'Publication version must be a positive integer.'));
  }
  if (!isDateString(publication.epoch)) {
    issues.push(issue('PUBLICATION_EPOCH_INVALID', 'error', `${path}.epoch`, 'Publication epoch must be an ISO date string.'));
  }
  if (typeof publication.siteId !== 'string' || publication.siteId.trim() === '') {
    issues.push(issue('PUBLICATION_SITE_REQUIRED', 'error', `${path}.siteId`, 'Publication siteId is required.'));
  }
  return issues;
}

export function validateSite(site, options = {}) {
  const issues = [];
  const path = options.path ?? 'site';
  if (!isObject(site)) return [issue('INVALID_SITE', 'error', path, 'Site must be an object.')];
  if (typeof site.id !== 'string' || site.id.trim() === '') {
    issues.push(issue('SITE_ID_REQUIRED', 'error', `${path}.id`, 'Site id is required.'));
  }
  if (typeof site.name !== 'string' || site.name.trim() === '') {
    issues.push(issue('SITE_NAME_REQUIRED', 'error', `${path}.name`, 'Site name is required.'));
  }
  if (typeof site.timezone !== 'string' || site.timezone.trim() === '') {
    issues.push(issue('SITE_TIMEZONE_REQUIRED', 'warning', `${path}.timezone`, 'Site timezone is empty; Asia/Seoul is assumed by the demo.'));
  } else {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: site.timezone }).format(new Date());
    } catch {
      issues.push(issue('SITE_TIMEZONE_INVALID', 'error', `${path}.timezone`, `Unknown timezone ${site.timezone}.`));
    }
  }
  const images = Array.isArray(site.images) ? site.images : [];
  const imageIds = new Set();
  images.forEach((image, index) => {
    issues.push(...validateImageAsset(image, { path: `${path}.images[${index}]` }));
    if (image?.id) {
      if (imageIds.has(image.id)) {
        issues.push(issue('IMAGE_ID_DUPLICATE', 'error', `${path}.images[${index}].id`, `Duplicate image id ${image.id}.`));
      }
      imageIds.add(image.id);
    }
  });
  const layouts = Array.isArray(site.layouts) ? site.layouts : [];
  const layoutIds = new Set();
  layouts.forEach((layout, index) => {
    issues.push(...validateLayout(layout, { path: `${path}.layouts[${index}]` }));
    if (layout?.id) {
      if (layoutIds.has(layout.id)) {
        issues.push(issue('LAYOUT_ID_DUPLICATE', 'error', `${path}.layouts[${index}].id`, `Duplicate layout id ${layout.id}.`));
      }
      layoutIds.add(layout.id);
    }
  });
  const playlists = Array.isArray(site.playlists) ? site.playlists : [];
  const playlistIds = new Set();
  playlists.forEach((playlist, index) => {
    issues.push(...validatePlaylist(playlist, { path: `${path}.playlists[${index}]`, imageIds }));
    if (playlist?.id) {
      if (playlistIds.has(playlist.id)) {
        issues.push(issue('PLAYLIST_ID_DUPLICATE', 'error', `${path}.playlists[${index}].id`, `Duplicate playlist id ${playlist.id}.`));
      }
      playlistIds.add(playlist.id);
    }
  });
  const groups = Array.isArray(site.groups) ? site.groups : [];
  const groupIds = new Set();
  groups.forEach((group, index) => {
    issues.push(...validateDisplayGroup(group, { path: `${path}.groups[${index}]` }));
    if (group?.id) {
      if (groupIds.has(group.id)) {
        issues.push(issue('GROUP_ID_DUPLICATE', 'error', `${path}.groups[${index}].id`, `Duplicate group id ${group.id}.`));
      }
      groupIds.add(group.id);
    }
    if (group?.layoutId && !layoutIds.has(group.layoutId)) {
      issues.push(issue('GROUP_LAYOUT_MISSING', 'error', `${path}.groups[${index}].layoutId`, `Layout ${group.layoutId} does not exist.`));
    }
    if (group?.playlistId && !playlistIds.has(group.playlistId)) {
      issues.push(issue('GROUP_PLAYLIST_MISSING', 'error', `${path}.groups[${index}].playlistId`, `Playlist ${group.playlistId} does not exist.`));
    }
  });
  const displays = Array.isArray(site.displays) ? site.displays : [];
  const displayIds = new Set();
  displays.forEach((display, index) => {
    issues.push(...validateDisplay(display, { path: `${path}.displays[${index}]` }));
    if (display?.id) {
      if (displayIds.has(display.id)) {
        issues.push(issue('DISPLAY_ID_DUPLICATE', 'error', `${path}.displays[${index}].id`, `Duplicate display id ${display.id}.`));
      }
      displayIds.add(display.id);
    }
    if (display?.groupId && !groupIds.has(display.groupId)) {
      issues.push(issue('DISPLAY_GROUP_MISSING', 'error', `${path}.displays[${index}].groupId`, `Group ${display.groupId} does not exist.`));
    }
  });
  if (site.publication !== undefined) {
    issues.push(...validatePublication(site.publication, { path: `${path}.publication` }));
    if (site.publication?.siteId && site.id && site.publication.siteId !== site.id) {
      issues.push(issue('PUBLICATION_SITE_MISMATCH', 'error', `${path}.publication.siteId`, 'Publication siteId does not match the site.'));
    }
  }
  return issues;
}

export function validateImageCounts(imageCount, displayCount) {
  const issues = [];
  if (!Number.isInteger(displayCount) || displayCount < 1) {
    issues.push(issue('NO_DISPLAYS', 'error', 'displays', 'At least one display is required.'));
    return issues;
  }
  if (!Number.isInteger(imageCount) || imageCount < 0) {
    issues.push(issue('IMAGE_COUNT_INVALID', 'error', 'playlist.items', 'Image count must be a non-negative integer.'));
    return issues;
  }
  if (imageCount === 0) {
    issues.push(issue('NO_IMAGES', 'warning', 'playlist.items', 'No images are published; every display shows a placeholder.'));
  } else if (imageCount === 1) {
    issues.push(issue('SINGLE_IMAGE', 'info', 'playlist.items', 'One image is repeated on every display and stays static.'));
  } else if (imageCount < displayCount) {
    issues.push(
      issue('FEWER_IMAGES_THAN_DISPLAYS', 'warning', 'playlist.items', `${imageCount} images for ${displayCount} displays; some images repeat.`),
    );
  } else if (imageCount > displayCount) {
    issues.push(
      issue('MORE_IMAGES_THAN_DISPLAYS', 'info', 'playlist.items', `${imageCount} images for ${displayCount} displays; the image window rotates.`),
    );
  }
  return issues;
}

function syncDurationWarning(playlist, mode) {
  if (!['synchronized-cycle', 'mirror', 'canvas'].includes(mode)) return [];
  const durations = (playlist?.items ?? []).map((item) => item.durationMs);
  if (durations.length < 2) return [];
  if (new Set(durations).size > 1) {
    return [
      issue(
        'SYNC_DURATION_OVERRIDE',
        'info',
        'playlist.items',
        'Synchronized modes use one group dwell; per-item durations are ignored for transitions.',
      ),
    ];
  }
  return [];
}

export function validateSnapshot(snapshot, options = {}) {
  const issues = [];
  const path = options.path ?? 'snapshot';
  if (!isObject(snapshot)) return [issue('INVALID_SNAPSHOT', 'error', path, 'Snapshot must be an object.')];
  if (!isObject(snapshot.group)) issues.push(issue('SNAPSHOT_GROUP_REQUIRED', 'error', `${path}.group`, 'Snapshot group is required.'));
  if (!isObject(snapshot.layout)) issues.push(issue('SNAPSHOT_LAYOUT_REQUIRED', 'error', `${path}.layout`, 'Snapshot layout is required.'));
  if (!isObject(snapshot.playlist)) issues.push(issue('SNAPSHOT_PLAYLIST_REQUIRED', 'error', `${path}.playlist`, 'Snapshot playlist is required.'));
  const displays = Array.isArray(snapshot.displays) ? snapshot.displays : [];
  const images = Array.isArray(snapshot.images) ? snapshot.images : [];
  if (displays.length === 0) issues.push(issue('NO_DISPLAYS', 'error', `${path}.displays`, 'Snapshot has no displays.'));
  displays.forEach((display, index) => {
    issues.push(...validateDisplay(display, { path: `${path}.displays[${index}]` }));
  });
  images.forEach((image, index) => {
    issues.push(...validateImageAsset(image, { path: `${path}.images[${index}]` }));
  });
  const layout = snapshot.layout;
  if (isObject(layout)) {
    issues.push(...validateLayout(layout, { path: `${path}.layout` }));
    if (layout.slots && displays.length > layout.slots.length) {
      issues.push(issue('DISPLAYS_WITHOUT_SLOT', 'warning', `${path}.layout.slots`, 'More displays than layout slots.'));
    } else if (layout.slots && displays.length < layout.slots.length) {
      issues.push(issue('EMPTY_LAYOUT_SLOTS', 'warning', `${path}.layout.slots`, 'Layout has empty slots; additions can fill them.'));
    }
  }
  const playlist = snapshot.playlist;
  if (isObject(playlist)) {
    const imageIds = new Set(images.map((image) => image.id));
    issues.push(...validatePlaylist(playlist, { path: `${path}.playlist`, imageIds }));
  }
  const mode = snapshot.mode ?? snapshot.group?.playbackMode;
  if (!PLAYBACK_MODES.includes(mode)) {
    issues.push(issue('SNAPSHOT_MODE_INVALID', 'error', `${path}.mode`, 'Snapshot mode is invalid.'));
  }
  const items = playlist?.items ?? [];
  issues.push(...validateImageCounts(items.length, displays.length));
  issues.push(...syncDurationWarning(playlist, mode));

  const validImages = images.filter((image) => isPositiveInt(image.width) && isPositiveInt(image.height));
  const seenAspects = new Set();
  for (const display of displays) {
    if (!isObject(display.resolution)) continue;
    for (const image of validImages) {
      const key = `${image.id}:${display.resolution.width}x${display.resolution.height}`;
      if (seenAspects.has(key)) continue;
      seenAspects.add(key);
      const fit = snapshot.settings?.fit ?? display.fit ?? 'contain';
      issues.push(...validateImageFit(image, display.resolution, fit, { path: `${path}.images` }));
    }
    if (display.status && display.status !== 'online') {
      issues.push(issue('DISPLAY_OFFLINE', 'warning', `${path}.displays`, `Display ${display.id} is ${display.status}.`));
    }
    if (mode === 'canvas' && display.rotation !== undefined && display.rotation !== 0 && display.rotation !== 180) {
      issues.push(
        issue(
          'CANVAS_ROTATION_UNVERIFIED',
          'warning',
          `${path}.displays`,
          `Canvas crop with display ${display.id} rotation ${display.rotation} is outside the verified PoC path.`,
        ),
      );
    }
  }
  return issues;
}

export function summarizeIssues(issues) {
  const summary = { errors: 0, warnings: 0, info: 0 };
  for (const item of issues) {
    if (item.severity === 'error') summary.errors += 1;
    else if (item.severity === 'warning') summary.warnings += 1;
    else summary.info += 1;
  }
  return summary;
}

export { issue as makeIssue };
