// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';

export interface EngineLayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineLayout {
  id: string;
  name: string;
  type: 'single' | 'row' | 'column' | 'grid' | 'custom';
  canvasWidth: number;
  canvasHeight: number;
  slots: EngineLayoutSlot[];
  gap: number;
  bezel: number;
}

export interface RenderPlan {
  displayId: string;
  displayName: string;
  siteId: string | null;
  at: string;
  atMs: number;
  mode: string;
  epochMs: number;
  dwellMs: number;
  imageCount: number;
  displayCount: number;
  imageIndex: number | null;
  imageId: string | null;
  itemId: string | null;
  image: Record<string, unknown> | null;
  imageUrl: string | null;
  rotation: number;
  fit: string;
  opacity: number;
  transitionMs: number;
  slot: number | null;
  slotId: string | null;
  slotRect: { x: number; y: number; w: number; h: number } | null;
  cycleIndex: number | null;
  offsetMs: number | null;
  slotStartMs: number | null;
  slotStartAt: string | null;
  nextChangeAtMs: number | null;
  nextChangeAt: string | null;
  static: boolean;
  placeholder: boolean;
  placeholderReason?: string;
  viewport: { width: number; height: number };
  sourceRect: { x: number; y: number; w: number; h: number } | null;
  destinationRect: { x: number; y: number; w: number; h: number };
  letterbox?: boolean;
  warnings: Array<{ code: string; severity: string; path: string; message: string }>;
}

interface EngineApi {
  buildLayout(options: Record<string, unknown>): EngineLayout;
  buildRenderPlan(snapshot: Record<string, unknown>, displayId: string, atMs: number): RenderPlan;
  slotForDisplay(
    layout: Record<string, unknown>,
    displays: Array<Record<string, unknown>>,
    displayId: string,
  ): EngineLayoutSlot | null;
  validateLayout(layout: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  validateSnapshot(snapshot: Record<string, unknown>, options?: Record<string, unknown>): unknown;
}

const localRequire = createRequire(import.meta.url);

// The pure, browser-safe PoC engine stays the only implementation of layout,
// crop/fit geometry, timeline selection, and transition boundaries.
export const engine = localRequire('../poc/packages/engine/index.js') as EngineApi;
