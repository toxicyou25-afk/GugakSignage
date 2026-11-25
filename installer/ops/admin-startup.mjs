// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function adminUrl(port) {
  const value = Number(port);
  const safePort = Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 3000;
  return `http://127.0.0.1:${safePort}/admin/`;
}

export function shouldOpenAdminOnStartup({
  enabled = true,
  headless = false,
  alreadyAttempted = false,
} = {}) {
  return Boolean(enabled && !headless && !alreadyAttempted);
}

export function launchAdminPage({ installDir, port, spawnImpl = spawn } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(installDir, 'ops', 'open-admin.ps1');
  if (!fs.existsSync(script)) throw new Error(`admin launcher not found: ${script}`);
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', script,
    '-Port', String(Number(port) || 3000),
  ];
  return new Promise((resolve, reject) => {
    let spawned = false;
    const child = spawnImpl(powershell, args, {
      cwd: installDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (typeof child.once === 'function') {
      child.once('spawn', () => {
        spawned = true;
        if (typeof child.unref === 'function') child.unref();
        resolve(true);
      });
      child.once('error', (error) => {
        if (!spawned) reject(error);
      });
    } else {
      resolve(true);
    }
  });
}

/** Opens the admin page once per watchdog process, independently of the player. */
export async function openAdminOnStartup({
  config = {},
  port,
  installDir,
  state = { attempted: false },
  launchImpl,
} = {}) {
  const enabled = config?.adminAutoOpen?.enabled !== false;
  const headless = config?.browserHeadless === true;
  if (state.attempted) return { opened: false, reason: 'already-attempted' };
  state.attempted = true;
  if (!enabled) return { opened: false, reason: 'disabled' };
  if (headless) return { opened: false, reason: 'headless' };
  if (!shouldOpenAdminOnStartup({ enabled, headless, alreadyAttempted: false })) {
    return { opened: false, reason: 'disabled' };
  }

  try {
    if (launchImpl) await launchImpl(adminUrl(port));
    else await launchAdminPage({ installDir, port });
    return { opened: true, reason: 'startup', url: adminUrl(port) };
  } catch (error) {
    return { opened: false, reason: 'launch-failed', error: error.message };
  }
}
