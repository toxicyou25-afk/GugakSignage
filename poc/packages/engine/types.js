// SPDX-License-Identifier: Apache-2.0
/**
 * Shared vocabulary for the signage PoC. These are deliberately plain JS
 * constants so the same engine can run in Node, a browser, or a native shell.
 */

export const PLAYBACK_MODES = Object.freeze([
  'individual',
  'synchronized-cycle',
  'mirror',
  'canvas',
]);

export const LAYOUT_TYPES = Object.freeze([
  'single',
  'row',
  'column',
  'grid',
  'custom',
]);

export const FIT_MODES = Object.freeze(['contain', 'cover', 'stretch']);
export const ORIENTATIONS = Object.freeze(['landscape', 'portrait']);
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
export const IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);

export const DEFAULT_DWELL_MS = 10_000;
export const DEFAULT_TRANSITION_MS = 400;
export const DEFAULT_ASPECT_TOLERANCE = 0.1;

/**
 * @typedef {{x:number,y:number,w:number,h:number}} Rect
 * @typedef {{width:number,height:number}} Resolution
 *
 * @typedef {object} ImageAsset
 * @property {string} id
 * @property {string} filename
 * @property {number} width
 * @property {number} height
 * @property {number} [aspectRatio]
 * @property {string} mime
 * @property {number} [size]
 * @property {string} [checksum]
 * @property {string} displayUrl
 * @property {string} [thumbnailUrl]
 * @property {string} [createdAt]
 *
 * @typedef {object} PlaylistItem
 * @property {string} id
 * @property {string} imageId
 * @property {number} durationMs
 * @property {'contain'|'cover'|'stretch'} [fitMode]
 * @property {number} [transitionMs]
 * @property {boolean} [enabled]
 *
 * @typedef {object} Playlist
 * @property {string} id
 * @property {string} name
 * @property {PlaylistItem[]} items
 *
 * @typedef {object} LayoutSlot
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} [displayId]
 * @property {number} [rotation]
 *
 * @typedef {object} Layout
 * @property {string} id
 * @property {string} name
 * @property {'single'|'row'|'column'|'grid'|'custom'} type
 * @property {number} canvasWidth
 * @property {number} canvasHeight
 * @property {LayoutSlot[]} slots
 * @property {number} [gap]
 * @property {number} [bezel]
 * @property {Rect} [safeArea]
 *
 * @typedef {object} Display
 * @property {string} id
 * @property {string} groupId
 * @property {string} name
 * @property {{width:number,height:number}} resolution
 * @property {'landscape'|'portrait'} orientation
 * @property {0|90|180|270} rotation
 * @property {string} [hardwareId]
 * @property {string} [slotId]
 * @property {number} [startIndex]
 * @property {number} [step]
 * @property {number} [startOffsetMs]
 * @property {string} [status]
 * @property {string} [lastSeen]
 * @property {string} [pairingState]
 * @property {'contain'|'cover'|'stretch'} [fit]
 *
 * @typedef {object} DisplayGroup
 * @property {string} id
 * @property {string} siteId
 * @property {string} name
 * @property {string} layoutId
 * @property {string} playlistId
 * @property {'individual'|'synchronized-cycle'|'mirror'|'canvas'} playbackMode
 * @property {string} epoch
 * @property {object} [settings]
 *
 * @typedef {object} Site
 * @property {string} id
 * @property {string} name
 * @property {string} timezone
 * @property {string} [siteKey]
 * @property {string} [notes]
 * @property {DisplayGroup[]} groups
 * @property {Display[]} displays
 * @property {Layout[]} layouts
 * @property {Playlist[]} playlists
 * @property {ImageAsset[]} images
 * @property {object} [publication]
 *
 * @typedef {object} Snapshot
 * @property {Site} [site]
 * @property {DisplayGroup} group
 * @property {Layout} layout
 * @property {Playlist} playlist
 * @property {Display[]} displays
 * @property {ImageAsset[]} images
 * @property {'individual'|'synchronized-cycle'|'mirror'|'canvas'} [mode]
 * @property {string|number} [epoch]
 * @property {number} [epochMs]
 * @property {number} [dwellMs]
 * @property {object} [settings]
 */

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function mod(value, divisor) {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor === 0) {
    return 0;
  }
  return ((value % divisor) + divisor) % divisor;
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundRect(rect, digits = 3) {
  return {
    x: round(rect.x, digits),
    y: round(rect.y, digits),
    w: round(rect.w, digits),
    h: round(rect.h, digits),
  };
}
