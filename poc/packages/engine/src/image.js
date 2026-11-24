// SPDX-License-Identifier: Apache-2.0
import { FIT_MODES, isFiniteNumber, round, roundRect } from '../types.js';

function dimensions(image) {
  const width = image?.width;
  const height = image?.height;
  return isFiniteNumber(width) && isFiniteNumber(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function normalizeRotation(rotation) {
  return [0, 90, 180, 270].includes(rotation) ? rotation : 0;
}

function normalizeFit(fit) {
  return FIT_MODES.includes(fit) ? fit : 'contain';
}

/**
 * Compute source crop and on-screen destination for one display.
 * destinationRect is in final display coordinates (post-rotation). For a
 * 90/270 rotation the renderer rotates the source crop into that rectangle.
 */
export function computeFitGeometry(image, viewport, fit = 'contain', rotation = 0) {
  const size = dimensions(image);
  if (!size) throw new Error('Image width/height must be positive');
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) {
    throw new Error('Viewport width/height must be positive');
  }
  const mode = normalizeFit(fit);
  const angle = normalizeRotation(rotation);
  const fullSource = { x: 0, y: 0, w: size.width, h: size.height };
  const fullDestination = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  const rotatedAwkward = angle === 90 || angle === 270;
  const imageAspect = size.width / size.height;

  if (mode === 'stretch') {
    return {
      fit: mode,
      rotation: angle,
      sourceRect: fullSource,
      destinationRect: fullDestination,
      letterbox: false,
    };
  }

  if (mode === 'contain') {
    const rotatedAspect = rotatedAwkward ? 1 / imageAspect : imageAspect;
    const viewportAspect = viewport.width / viewport.height;
    let w;
    let h;
    if (viewportAspect >= rotatedAspect) {
      h = viewport.height;
      w = h * rotatedAspect;
    } else {
      w = viewport.width;
      h = w / rotatedAspect;
    }
    return {
      fit: mode,
      rotation: angle,
      sourceRect: fullSource,
      destinationRect: roundRect({ x: (viewport.width - w) / 2, y: (viewport.height - h) / 2, w, h }),
      letterbox: true,
    };
  }

  // cover: crop the source so its rotated aspect exactly fills the viewport.
  const targetCropAspect = rotatedAwkward ? viewport.height / viewport.width : viewport.width / viewport.height;
  let cropW;
  let cropH;
  if (imageAspect >= targetCropAspect) {
    cropH = size.height;
    cropW = cropH * targetCropAspect;
  } else {
    cropW = size.width;
    cropH = cropW / targetCropAspect;
  }
  return {
    fit: mode,
    rotation: angle,
    sourceRect: roundRect({ x: (size.width - cropW) / 2, y: (size.height - cropH) / 2, w: cropW, h: cropH }),
    destinationRect: fullDestination,
    letterbox: false,
  };
}

/**
 * Map one display's slot to a crop of the image placed on the virtual canvas.
 * The destination rectangle is display-local. Areas outside a contain-fitted
 * image become a smaller destination rect, leaving the background visible.
 */
export function computeCanvasGeometry(
  image,
  layout,
  slot,
  viewport,
  fit = 'cover',
  rotation = 0,
) {
  const size = dimensions(image);
  if (!size) throw new Error('Image width/height must be positive');
  if (!layout || !(layout.canvasWidth > 0) || !(layout.canvasHeight > 0)) {
    throw new Error('Canvas layout dimensions must be positive');
  }
  if (!slot) throw new Error('Canvas display is not assigned to a slot');
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) {
    throw new Error('Viewport width/height must be positive');
  }
  const mode = normalizeFit(fit);
  const angle = normalizeRotation(rotation);
  const canvasW = layout.canvasWidth;
  const canvasH = layout.canvasHeight;
  const imageAspect = size.width / size.height;
  const canvasAspect = canvasW / canvasH;
  let scaleX;
  let scaleY;
  let drawW;
  let drawH;
  if (mode === 'stretch') {
    scaleX = canvasW / size.width;
    scaleY = canvasH / size.height;
    drawW = canvasW;
    drawH = canvasH;
  } else if (mode === 'contain') {
    const scale = Math.min(canvasW / size.width, canvasH / size.height);
    scaleX = scale;
    scaleY = scale;
    drawW = size.width * scale;
    drawH = size.height * scale;
  } else {
    const scale = Math.max(canvasW / size.width, canvasH / size.height);
    scaleX = scale;
    scaleY = scale;
    drawW = size.width * scale;
    drawH = size.height * scale;
  }
  const drawX = (canvasW - drawW) / 2;
  const drawY = (canvasH - drawH) / 2;
  const slotX = slot.x * canvasW;
  const slotY = slot.y * canvasH;
  const slotW = slot.w * canvasW;
  const slotH = slot.h * canvasH;
  const ix = Math.max(slotX, drawX);
  const iy = Math.max(slotY, drawY);
  const right = Math.min(slotX + slotW, drawX + drawW);
  const bottom = Math.min(slotY + slotH, drawY + drawH);
  const visibleW = Math.max(0, right - ix);
  const visibleH = Math.max(0, bottom - iy);
  if (visibleW === 0 || visibleH === 0) {
    return {
      fit: mode,
      rotation: angle,
      sourceRect: { x: 0, y: 0, w: 0, h: 0 },
      destinationRect: { x: 0, y: 0, w: 0, h: 0 },
      letterbox: true,
      visible: false,
    };
  }
  return {
    fit: mode,
    rotation: angle,
    sourceRect: roundRect({
      x: (ix - drawX) / scaleX,
      y: (iy - drawY) / scaleY,
      w: visibleW / scaleX,
      h: visibleH / scaleY,
    }),
    destinationRect: roundRect({
      x: ((ix - slotX) / slotW) * viewport.width,
      y: ((iy - slotY) / slotH) * viewport.height,
      w: (visibleW / slotW) * viewport.width,
      h: (visibleH / slotH) * viewport.height,
    }),
    letterbox: mode === 'contain',
    visible: true,
    canvasImageRect: roundRect({ x: drawX, y: drawY, w: drawW, h: drawH }),
  };
}

export function imageAspect(image) {
  const size = dimensions(image);
  return size ? round(size.width / size.height, 4) : 0;
}

export function displayAspect(display) {
  return imageAspect(display?.resolution);
}
