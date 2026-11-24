// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRenderPlan,
  manifestForDisplay,
  patternPreview,
  resolveTimeline,
  summarizeIssues,
  validateSite,
} from '../packages/engine/index.js';
import { createDemoState } from '../apps/server/demo-data.js';
import { FIXTURE_EPOCH, makeSite, timeAtSlot } from '../test-support/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(here, '../artifacts');
const checks = [];
const metrics = {};

function check(name, condition, details = '') {
  checks.push({ name, pass: Boolean(condition), details });
  if (!condition) console.error(`FAIL ${name}${details ? `: ${details}` : ''}`);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

const matrix = [];
for (const displayCount of [1, 4, 8]) {
  for (const imageCount of [0, 1, 3, 10]) {
    for (const mode of ['individual', 'synchronized-cycle', 'mirror', 'canvas']) {
      const { snapshot } = makeSite({ imageCount, displayCount, mode });
      const at = timeAtSlot(snapshot, 3);
      const plans = snapshot.displays.map((display) => buildRenderPlan(snapshot, display.id, at));
      const row = {
        displayCount,
        imageCount,
        mode,
        plans: plans.length,
        placeholder: imageCount === 0,
        allHaveViewport: plans.every((plan) => plan.viewport.width > 0 && plan.viewport.height > 0),
      };
      matrix.push(row);
      check(
        `${imageCount} images / ${displayCount} displays / ${mode}`,
        plans.length === displayCount && row.allHaveViewport && plans.every((plan) => (imageCount === 0 ? plan.placeholder : !plan.placeholder)),
      );
    }
  }
}
metrics.matrixScenarios = matrix.length;

const cycle = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' }).snapshot;
const lateAt = FIXTURE_EPOCH + 95_000;
const late = buildRenderPlan(cycle, 'disp-4', lateAt);
const lateOld = buildRenderPlan(cycle, 'disp-4', lateAt + 20);
check('late join enters the current slot', late.slot === Math.floor(95_000 / cycle.dwellMs) && late.imageIndex === lateOld.imageIndex, `slot=${late.slot}`);
metrics.lateJoin = { slot: late.slot, imageIndex: late.imageIndex, nextChangeAt: late.nextChangeAt };

const start = FIXTURE_EPOCH + 2_000;
const driftPpm = 50;
const offlineDurationMs = 10 * 60_000;
const onlinePlan = buildRenderPlan(cycle, 'disp-2', start);
const offlineClockAtStart = start + 120;
const offlineClockTenMinutes = offlineClockAtStart + offlineDurationMs + (offlineDurationMs * driftPpm) / 1_000_000;
const trueServerTime = start + offlineDurationMs;
const offlinePlan = buildRenderPlan(cycle, 'disp-2', offlineClockAtStart);
const serverExpected = resolveTimeline(cycle, 'disp-2', trueServerTime);
const offlineTenMinutes = resolveTimeline(cycle, 'disp-2', offlineClockTenMinutes);
const timeErrorMs = offlineClockTenMinutes - trueServerTime;
let driftImageMismatches = 0;
let maxMismatchBoundaryDistanceMs = 0;
for (let offset = 0; offset <= offlineDurationMs; offset += 997) {
  const truePlan = resolveTimeline(cycle, 'disp-2', start + offset);
  const localPlan = resolveTimeline(cycle, 'disp-2', offlineClockAtStart + offset + (offset * driftPpm) / 1_000_000);
  if (truePlan.imageIndex !== localPlan.imageIndex) {
    driftImageMismatches += 1;
    const distanceToNextBoundary = cycle.dwellMs - ((start + offset - cycle.epochMs) % cycle.dwellMs);
    maxMismatchBoundaryDistanceMs = Math.max(maxMismatchBoundaryDistanceMs, distanceToNextBoundary);
  }
}
check(
  '10 minute offline playback advances 60 slots with bounded clock drift',
  offlineTenMinutes.slot - offlinePlan.slot === 60 && Math.abs(timeErrorMs) < 200 && maxMismatchBoundaryDistanceMs < 200,
  `slot delta=${offlineTenMinutes.slot - offlinePlan.slot}, clock error=${timeErrorMs}ms, image mismatches=${driftImageMismatches}`,
);
check('online and offline plans agree away from a boundary', onlinePlan.imageIndex === offlinePlan.imageIndex, `${onlinePlan.imageIndex} vs ${offlinePlan.imageIndex}`);
metrics.offline = {
  durationMs: offlineDurationMs,
  driftPpm,
  slotDelta: offlineTenMinutes.slot - offlinePlan.slot,
  transitionErrorMs: timeErrorMs,
  imageMismatches: driftImageMismatches,
  maxMismatchBoundaryDistanceMs,
  expectedAtServerTime: serverExpected.imageIndex,
  offlineAtServerTime: offlineTenMinutes.imageIndex,
};

const beforeRestart = buildRenderPlan(cycle, 'disp-3', lateAt);
const restoredSnapshot = JSON.parse(JSON.stringify(cycle));
const afterRestart = buildRenderPlan(restoredSnapshot, 'disp-3', lateAt);
check('server restart with persisted epoch resumes the same plan', beforeRestart.imageId === afterRestart.imageId && beforeRestart.slot === afterRestart.slot);
metrics.restart = { epoch: cycle.epoch, slot: beforeRestart.slot, imageId: beforeRestart.imageId };

const beforeRemove = buildRenderPlan(cycle, 'disp-4', lateAt);
const withoutTwo = { ...cycle, displays: cycle.displays.filter((display) => display.id !== 'disp-2') };
const afterRemove = buildRenderPlan(withoutTwo, 'disp-4', lateAt);
check('removing a display preserves other playback positions', beforeRemove.imageId === afterRemove.imageId && beforeRemove.slot === afterRemove.slot);
const addedDisplay = {
  id: 'disp-a-new',
  groupId: 'group-1',
  name: 'New display',
  resolution: { width: 1920, height: 1080 },
  orientation: 'landscape',
  rotation: 0,
  startIndex: 99,
  step: 1,
  status: 'online',
};
const withAdded = { ...withoutTwo, displays: [...withoutTwo.displays, addedDisplay] };
const addedPlan = buildRenderPlan(withAdded, 'disp-a-new', lateAt);
check('added display fills an open slot without resetting epoch', addedPlan.slotId === 'slot-2' && addedPlan.epochMs === cycle.epochMs, `slot=${addedPlan.slotId}`);
metrics.addRemove = { slotId: addedPlan.slotId, imageIndex: addedPlan.imageIndex, epochMs: addedPlan.epochMs };

const two = makeSite({ imageCount: 3, displayCount: 4, mode: 'synchronized-cycle' }).snapshot;
const pattern = patternPreview(two);
check('pattern preview stops at LCM(3,4)=12', pattern.periodSlots === 12 && pattern.rows.length === 12);
metrics.pattern = { periodSlots: pattern.periodSlots, rows: pattern.rows.length };

const demo = createDemoState(FIXTURE_EPOCH + 60_000);
const demoReports = [];
for (const site of demo.sites) {
  const issues = summarizeIssues(validateSite(site));
  check(`demo site ${site.id} has no validation errors`, issues.errors === 0, JSON.stringify(issues));
  const first = site.displays[0];
  if (!first) continue;
  const manifest = manifestForDisplay(site, first.id, { now: FIXTURE_EPOCH + 65_000 });
  const plans = manifest.displays.map((display) => buildRenderPlan(manifest, display.id, FIXTURE_EPOCH + 65_000));
  demoReports.push({
    siteId: site.id,
    mode: manifest.mode,
    displays: manifest.displays.length,
    images: manifest.playlist.items.length,
    warnings: manifest.validation.summary,
    plans: plans.map((plan) => ({
      displayId: plan.displayId,
      imageId: plan.imageId,
      slot: plan.slot,
      sourceRect: plan.sourceRect,
      destinationRect: plan.destinationRect,
      placeholder: plan.placeholder,
    })),
  });
  check(`demo site ${site.id} generates plans for every display`, plans.length === site.displays.length);
}
metrics.demoSites = demoReports;

const pass = checks.every((item) => item.pass);
const report = {
  generatedAt: new Date().toISOString(),
  pass,
  checks: checks.length,
  passed: checks.filter((item) => item.pass).length,
  failed: checks.filter((item) => !item.pass),
  metrics,
};
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(path.join(artifactDir, 'scenario-report.json'), JSON.stringify(report, null, 2));
console.log(`Scenario simulation: ${report.passed}/${report.checks} checks passed`);
console.log(`Matrix: ${metrics.matrixScenarios} scenarios (3 display counts x 4 image counts x 4 modes)`);
console.log(`Offline 10m slot delta: ${metrics.offline.slotDelta}; error: ${metrics.offline.transitionErrorMs}ms`);
console.log(`Report: ${path.join(artifactDir, 'scenario-report.json')}`);
if (!pass) process.exitCode = 1;
