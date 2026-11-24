// SPDX-License-Identifier: Apache-2.0

export function classifyPlayerState(result, heartbeatMaxAgeMs) {
  if (!result?.playerReady || !result.state) {
    return { kind: 'not-ready', responsive: true, healthy: false, actionable: true };
  }
  const state = result.state;
  if (state.currentContentId) {
    if (state.offline) {
      return { kind: 'cached', responsive: true, healthy: true, actionable: false };
    }
    const heartbeatAt = Date.parse(state.lastHeartbeatAt || '');
    if (Number.isFinite(heartbeatAt) && result.now - heartbeatAt <= heartbeatMaxAgeMs) {
      return { kind: 'playing', responsive: true, healthy: true, actionable: false };
    }
    return { kind: 'playback-stalled', responsive: true, healthy: false, actionable: true };
  }
  if (state.lastError) {
    return { kind: 'error-screen', responsive: true, healthy: false, actionable: false };
  }
  if (!state.deviceId) {
    return { kind: 'pairing', responsive: true, healthy: false, actionable: false };
  }
  return { kind: 'waiting', responsive: true, healthy: false, actionable: false };
}
