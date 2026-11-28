// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMonitorSnapshots, discoverNativeMonitors, NativeMonitorSnapshotTracker, parseNativeMonitorOutput, type NativeMonitor } from '../src/native-monitors.js';

const monitor = { deviceName: '\\\\.\\DISPLAY1', friendlyName: 'Primary Display', stableId: 'MONITOR\\ABC', bindingId: 'MONITOR\\ABC', x: 0, y: 0, width: 1920, height: 1080, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 }, orientation: 'landscape', primary: true, attached: true };

test('parses one attached physical monitor and detection timestamp', () => {
  const detectedAt = '2026-11-27T00:00:00.000Z';
  const result = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [monitor] }), detectedAt);
  assert.equal(result.supported, true);
  assert.equal(result.detectedAt, detectedAt);
  assert.deepEqual(result.monitors[0], {
    stableId: monitor.stableId, bindingId: monitor.stableId, deviceName: monitor.deviceName, friendlyName: monitor.friendlyName,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 },
    orientation: 'landscape', primary: true, attached: true,
  });
});

test('parses multiple displays including negative desktop positions and portrait orientation', () => {
  const second = { ...monitor, deviceName: '\\\\.\\DISPLAY2', stableId: 'MONITOR\\DEF', x: -1080, y: 0, width: 1080, height: 1920, orientation: 'portrait', primary: false };
  const result = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [monitor, second] }));
  assert.equal(result.monitors.length, 2);
  assert.deepEqual(result.monitors[1].bounds, { x: -1080, y: 0, width: 1080, height: 1920 });
  assert.equal(result.monitors[1].orientation, 'portrait');
});

test('qualifies identical monitor IDs with unique Windows DeviceKeys and detects an identity change', () => {
  const first = { ...monitor, stableId: 'MONITOR\\SAME-MODEL', bindingId: 'MONITOR\\SAME-MODEL', deviceId: 'MONITOR\\SAME-MODEL', deviceKey: 'OUTPUT-KEY-A' };
  const second = { ...first, deviceName: '\\\\.\\DISPLAY2', deviceKey: 'OUTPUT-KEY-B', primary: false };
  const initial = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [first, second] }));

  assert.equal(initial.monitors.length, 2);
  assert.equal(initial.monitors[0]?.identityStatus, 'supplement-qualified');
  assert.equal(initial.monitors[1]?.identityStatus, 'supplement-qualified');
  assert.notEqual(initial.monitors[0]?.stableId, initial.monitors[1]?.stableId);
  assert.notEqual(initial.monitors[0]?.bindingId, initial.monitors[1]?.bindingId);
  assert.ok(initial.monitors.every((entry) => entry.bindingId?.startsWith('MONITOR\\SAME-MODEL|KEY-')));

  const changedIdentity = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [
    { ...first, deviceKey: 'OUTPUT-KEY-C' }, second,
  ] }));
  const changes = compareMonitorSnapshots(initial.monitors, changedIdentity.monitors);
  assert.ok(changes.some((change) => change.type === 'disconnected'));
  assert.ok(changes.some((change) => change.type === 'connected'));
});

test('marks same-model monitors ambiguous when Windows exposes no unique output key', () => {
  const first = { ...monitor, stableId: 'MONITOR\\SAME-MODEL', bindingId: 'MONITOR\\SAME-MODEL', deviceId: 'MONITOR\\SAME-MODEL', deviceKey: 'SHARED-KEY' };
  const second = { ...first, deviceName: '\\\\.\\DISPLAY2', primary: false };
  const result = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [first, second] }));

  assert.equal(result.monitors.length, 2);
  assert.ok(result.monitors.every((entry) => entry.identityStatus === 'ambiguous'));
  assert.ok(result.monitors.every((entry) => entry.bindingId?.startsWith('MONITOR\\SAME-MODEL|OUTPUT-')));
  assert.equal(new Set(result.monitors.map((entry) => entry.stableId)).size, 2);
  assert.equal(new Set(result.monitors.map((entry) => entry.bindingId)).size, 2);

  const reordered = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [second, first] }));
  const identitiesByOutput = (monitors: NativeMonitor[]) => Object.fromEntries(monitors.map((entry) => [entry.deviceName, entry.bindingId]));
  assert.deepEqual(identitiesByOutput(reordered.monitors), identitiesByOutput(result.monitors));
});

test('keeps a detected display when Windows supplies null identity supplements', () => {
  const fallback = { ...monitor, stableId: '\\\\.\\DISPLAY1', bindingId: null, deviceId: null, deviceKey: null };
  const result = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [fallback] }));

  assert.equal(result.error, undefined);
  assert.equal(result.monitors.length, 1);
  assert.equal(result.monitors[0]?.stableId, fallback.stableId);
  assert.equal(result.monitors[0]?.bindingId, null);
  assert.equal(result.monitors[0]?.identityStatus, 'unavailable');
});

test('malformed native output returns a clear discovery error', () => {
  for (const output of ['', 'not json', '{"supported":true}']) {
    assert.equal(parseNativeMonitorOutput(output).error, 'Windows display discovery returned no monitor data.');
  }
});

test('monitor discovery does not accept connector-only IDs as stable physical identity', () => {
  const withoutStableId = { ...monitor, stableId: '\\\\.\\DISPLAY1', bindingId: null };
  const result = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [withoutStableId] }));
  assert.equal(result.monitors[0]?.stableId, '\\\\.\\DISPLAY1');
  assert.equal(result.monitors[0]?.bindingId, null);
});

test('monitor discovery never promotes an omitted or malformed binding ID to a selectable ID', () => {
  const omitted = { ...monitor } as Record<string, unknown>;
  delete omitted.bindingId;
  const malformed = { ...monitor, bindingId: '\\\\.\\DISPLAY1' };
  const omittedResult = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [omitted] }));
  const malformedResult = parseNativeMonitorOutput(JSON.stringify({ supported: true, monitors: [malformed] }));
  assert.equal(omittedResult.monitors[0]?.bindingId, null);
  assert.equal(malformedResult.monitors[0]?.bindingId, null);
});


test('parses a successful empty snapshot without treating it as discovery failure', () => {
  const result = parseNativeMonitorOutput('{"supported":true,"monitors":[]}');
  assert.equal(result.supported, true);
  assert.deepEqual(result.monitors, []);
  assert.equal(result.error, undefined);
});

test('uses the first successful snapshot as a silent baseline, then reports a later connection', () => {
  const tracker = new NativeMonitorSnapshotTracker();
  const initial = { supported: true, detectedAt: '2026-11-27T00:00:00.000Z', monitors: [monitor] };
  assert.deepEqual(compareMonitorSnapshots(null, [monitor]), []);
  assert.deepEqual(tracker.update(initial).changes, []);
  const second = { ...monitor, stableId: 'MONITOR\\DEF', deviceName: '\\\\.\\DISPLAY2' };
  assert.deepEqual(tracker.update({ ...initial, monitors: [monitor, second] }).changes, [
    { type: 'connected', stableId: 'MONITOR\\DEF', monitor: second },
  ]);
});

test('reports additions and removals by stable ID', () => {
  const second = { ...monitor, stableId: 'MONITOR\\DEF', deviceName: '\\\\.\\DISPLAY2' };
  assert.deepEqual(compareMonitorSnapshots([monitor, second], [second]), [
    { type: 'disconnected', stableId: 'MONITOR\\ABC', monitor },
  ]);
  assert.deepEqual(compareMonitorSnapshots([monitor], [monitor, second]), [
    { type: 'connected', stableId: 'MONITOR\\DEF', monitor: second },
  ]);
});

test('reports bounds, resolution, orientation, and primary changes for the same stable ID', () => {
  const previous = [{ ...monitor, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, resolution: { width: 1920, height: 1080 } }];
  const current = [{ ...monitor, x: 1920, y: 0, width: 1080, height: 1920, orientation: 'portrait', primary: false,
    bounds: { x: 1920, y: 0, width: 1080, height: 1920 }, resolution: { width: 1080, height: 1920 } }];
  assert.deepEqual(compareMonitorSnapshots(previous, current), [{
    type: 'changed', stableId: 'MONITOR\\ABC', monitor: current[0], changedAttributes: ['bounds', 'resolution', 'orientation', 'primary'],
  }]);
});

test('reports output-number and identity-confidence changes for manual monitor remapping', () => {
  const previous = [{ ...monitor, identityStatus: 'supplement-qualified' as const }];
  const current = [{ ...monitor, deviceName: '\\\\.\\DISPLAY2', bindingId: 'MONITOR\\ABC|OUTPUT-2', identityStatus: 'ambiguous' as const }];
  assert.deepEqual(compareMonitorSnapshots(previous, current), [{
    type: 'changed', stableId: monitor.stableId, monitor: current[0], changedAttributes: ['deviceName', 'identity'],
  }]);
});

test('an empty successful snapshot disconnects all previous monitors', () => {
  assert.deepEqual(compareMonitorSnapshots([monitor], []), [
    { type: 'disconnected', stableId: 'MONITOR\\ABC', monitor },
  ]);
  assert.deepEqual(compareMonitorSnapshots([], []), []);
});

test('unsupported or failed discovery preserves the prior successful snapshot', () => {
  const tracker = new NativeMonitorSnapshotTracker();
  const initial = { supported: true, detectedAt: '2026-11-27T00:00:00.000Z', monitors: [monitor] };
  assert.deepEqual(tracker.update(initial).changes, []);
  assert.deepEqual(tracker.update({ ...initial, supported: false, error: 'unsupported', monitors: [] }).changes, []);
  assert.deepEqual(tracker.update({ ...initial, error: 'discovery failed', monitors: [] }).changes, []);
  const empty = tracker.update({ ...initial, monitors: [] });
  assert.deepEqual(empty.changes, [{ type: 'disconnected', stableId: 'MONITOR\\ABC', monitor }]);
});

test('reports unsupported platforms without attempting Windows discovery', async () => {
  const result = await discoverNativeMonitors('linux', process.cwd());
  assert.equal(result.supported, false);
  assert.equal(result.monitors.length, 0);
  assert.match(result.error || '', /only on Windows/);
});
