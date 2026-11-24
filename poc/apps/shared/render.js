// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-only drawing helper. It consumes the engine's RenderPlan without
 * containing any playback rules of its own.
 */

function rotationRadians(rotation) {
  return (([0, 90, 180, 270].includes(rotation) ? rotation : 0) * Math.PI) / 180;
}

function drawPlaceholder(ctx, width, height, label) {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);
  const step = Math.max(40, Math.min(width, height) / 12);
  ctx.strokeStyle = 'rgba(216, 162, 58, 0.10)';
  ctx.lineWidth = 2;
  for (let x = -height; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(244, 239, 227, 0.75)';
  ctx.font = `600 ${Math.max(16, Math.min(width, height) / 24)}px 'Malgun Gothic', 'Noto Sans KR', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2);
}

export function resizeCanvas(canvas, cssWidth, cssHeight) {
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { dpr, cssWidth, cssHeight };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} plan RenderPlan from the engine
 * @param {{image?: HTMLImageElement, width?: number, height?: number, background?: string, placeholderText?: string}} options
 */
export function drawPlanToCanvas(canvas, plan, options = {}) {
  const width = Math.max(1, Math.round(options.width ?? canvas.clientWidth ?? plan?.viewport?.width ?? 1));
  const height = Math.max(1, Math.round(options.height ?? canvas.clientHeight ?? plan?.viewport?.height ?? 1));
  const { dpr } = resizeCanvas(canvas, width, height);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.background ?? '#060b13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!plan) return;
  const viewport = plan.viewport ?? { width: plan.destinationRect?.w ?? width, height: plan.destinationRect?.h ?? height };
  const scale = Math.min(width / viewport.width, height / viewport.height);
  const offsetX = (width - viewport.width * scale) / 2;
  const offsetY = (height - viewport.height * scale) / 2;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
  ctx.fillStyle = options.background ?? '#060b13';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  if (plan.placeholder || !plan.sourceRect || !options.image) {
    drawPlaceholder(ctx, viewport.width, viewport.height, options.placeholderText ?? '콘텐츠 없음 · No content');
    return;
  }
  const source = plan.sourceRect;
  const destination = plan.destinationRect;
  if (!(source.w > 0 && source.h > 0 && destination.w > 0 && destination.h > 0)) return;
  ctx.save();
  ctx.translate(destination.x + destination.w / 2, destination.y + destination.h / 2);
  ctx.rotate(rotationRadians(plan.rotation));
  const preRotationWidth = plan.rotation === 90 || plan.rotation === 270 ? destination.h : destination.w;
  const preRotationHeight = plan.rotation === 90 || plan.rotation === 270 ? destination.w : destination.h;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    options.image,
    source.x,
    source.y,
    source.w,
    source.h,
    -preRotationWidth / 2,
    -preRotationHeight / 2,
    preRotationWidth,
    preRotationHeight,
  );
  ctx.restore();
}

export class FadeRenderer {
  constructor(canvases, options = {}) {
    if (!Array.isArray(canvases) || canvases.length !== 2) throw new Error('FadeRenderer needs two canvases');
    this.canvases = canvases;
    this.background = options.background ?? '#060b13';
    this.placeholderText = options.placeholderText ?? '콘텐츠 없음 · No content';
    this.active = 0;
    this.currentKey = null;
    this.timer = null;
    this.currentPlan = null;
    this.first = true;
    for (const canvas of canvases) {
      canvas.style.opacity = '0';
      canvas.style.transition = 'none';
    }
  }

  draw(plan, image, options = {}) {
    const target = this.canvases[this.active ^ 1];
    drawPlanToCanvas(target, plan, {
      image,
      background: this.background,
      placeholderText: this.placeholderText,
      ...options,
    });
    return target;
  }

  show(plan, image, options = {}) {
    const key = [
      plan.imageId ?? 'empty',
      plan.fit,
      plan.rotation,
      plan.slotId ?? '',
      plan.placeholder ? 'placeholder' : 'image',
      Math.round(plan.destinationRect?.w ?? 0),
      Math.round(plan.destinationRect?.h ?? 0),
    ].join('|');
    if (this.currentKey === key) return false;
    const previous = this.canvases[this.active];
    const target = this.draw(plan, image, options);
    const transitionMs = this.first ? 0 : Math.max(0, plan.transitionMs ?? 0);
    if (this.timer) clearTimeout(this.timer);
    target.style.transition = 'none';
    target.style.opacity = transitionMs > 0 ? '0' : '1';
    target.style.zIndex = '2';
    previous.style.zIndex = '1';
    if (this.first || transitionMs === 0) {
      previous.style.opacity = '0';
    } else {
      requestAnimationFrame(() => {
        target.style.transition = `opacity ${transitionMs}ms linear`;
        target.style.opacity = '1';
      });
      this.timer = setTimeout(() => {
        previous.style.opacity = '0';
      }, transitionMs + 40);
    }
    this.active ^= 1;
    this.currentKey = key;
    this.currentPlan = plan;
    this.first = false;
    return true;
  }

  resize(plan, image) {
    if (!plan) return;
    const active = this.canvases[this.active];
    drawPlanToCanvas(active, plan, {
      image,
      background: this.background,
      placeholderText: this.placeholderText,
    });
    active.style.opacity = '1';
  }
}
