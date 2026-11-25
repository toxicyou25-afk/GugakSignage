// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';

function normalizedWindowsPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return path.win32.normalize(text).replace(/[\\/]+$/g, '').toLowerCase();
}

function normalizedCommandLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function playerTargetMatches(targetUrl, expectedPlayerUrl) {
  try {
    const actual = new URL(String(targetUrl));
    const expected = new URL(String(expectedPlayerUrl));
    return actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname &&
      actual.port === expected.port &&
      actual.pathname === expected.pathname &&
      (actual.searchParams.get('code') || '') === (expected.searchParams.get('code') || '');
  } catch {
    return false;
  }
}

function startTimeMatches(actual, expected, toleranceMs) {
  const actualTime = Date.parse(String(actual || ''));
  const expectedTime = Date.parse(String(expected || ''));
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) &&
    Math.abs(actualTime - expectedTime) <= toleranceMs;
}

function identityReasons({
  processInfo,
  cdpTargets,
  browserPath,
  profileDir,
  debugPort,
  playerUrl,
  startedAt,
  startTimeToleranceMs,
  requireCdp,
}) {
  const reasons = [];
  const expectedExecutable = normalizedWindowsPath(browserPath);
  const actualExecutable = normalizedWindowsPath(processInfo?.executablePath);
  if (!actualExecutable || !expectedExecutable || actualExecutable !== expectedExecutable) {
    reasons.push('executable-mismatch');
  }
  const commandLine = normalizedCommandLine(processInfo?.commandLine);
  const profile = normalizedWindowsPath(profileDir);
  if (!profile || (!commandLine.includes(profile) && !commandLine.includes(profile.replace(/\\/g, '/')))) {
    reasons.push('profile-mismatch');
  }
  const portToken = `--remote-debugging-port=${Number(debugPort)}`.toLowerCase();
  if (!Number.isInteger(Number(debugPort)) || Number(debugPort) <= 0 || !commandLine.includes(portToken)) {
    reasons.push('debug-port-mismatch');
  }
  if (!playerUrl || !commandLine.includes(String(playerUrl).toLowerCase())) {
    reasons.push('player-url-mismatch');
  }
  if (!startTimeMatches(processInfo?.creationDate, startedAt, startTimeToleranceMs)) {
    reasons.push('start-time-mismatch');
  }
  if (requireCdp) {
    const hasPlayerTarget = Array.isArray(cdpTargets) && cdpTargets.some((target) =>
      target?.type === 'page' && playerTargetMatches(target.url, playerUrl),
    );
    if (!hasPlayerTarget) reasons.push('cdp-player-target-missing');
  }
  return reasons;
}

export function verifyPlayerProcessIdentity({
  processInfo,
  cdpTargets,
  browserPath,
  profileDir,
  debugPort,
  playerUrl,
  startedAt,
  startTimeToleranceMs = 10000,
  requireCdp = true,
} = {}) {
  const reasons = identityReasons({
    processInfo,
    cdpTargets,
    browserPath,
    profileDir,
    debugPort,
    playerUrl,
    startedAt,
    startTimeToleranceMs,
    requireCdp,
  });
  return { ok: reasons.length === 0, reasons };
}

export function verifyAdoptedPlayerStillOwned({
  processInfo,
  browserPath,
  profileDir,
  debugPort,
  playerUrl,
  startedAt,
  startTimeToleranceMs = 10000,
} = {}) {
  return verifyPlayerProcessIdentity({
    processInfo,
    browserPath,
    profileDir,
    debugPort,
    playerUrl,
    startedAt,
    startTimeToleranceMs,
    requireCdp: false,
  });
}
