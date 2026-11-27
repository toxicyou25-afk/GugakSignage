/* SPDX-License-Identifier: Apache-2.0 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface PlayerCredentialStore {
  readToken(): Promise<string | null>;
  writeToken(token: string): Promise<void>;
  clear(): Promise<void>;
  clearIfToken?(expected: string): Promise<void>;
  readRegistrationRetry?(): Promise<string | null>;
  writeRegistrationRetry?(value: string | null): Promise<void>;
}

export interface PlayerIdentityStore {
  getOrCreateHardwareId(): Promise<string>;
}

const PROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$inputText = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($inputText)',
  '$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($encrypted))',
].join('; ');

const UNPROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$inputText = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($inputText)',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('; ');

function runDpapi(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.once('error', () => reject(new Error('Windows DPAPI operation failed')));
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error('Windows DPAPI operation failed'));
        return;
      }
      resolve(Buffer.concat(output).toString('utf8').trim());
    });
    child.stdin.once('error', () => undefined);
    child.stdin.end(input);
  });
}

export function createPlayerCredentialStore(options: { filePath: string; platform?: NodeJS.Platform }): PlayerCredentialStore {
  const platform = options.platform ?? process.platform;
  const ensureWindows = () => {
    if (platform !== 'win32') throw new Error('Player credential storage requires Windows DPAPI');
  };

  type StoredState = { token: string | null; registrationRetry: string | null };
  let queue: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  async function readState(): Promise<StoredState> {
      ensureWindows();
      let ciphertext: string;
      try {
        ciphertext = await readFile(options.filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { token: null, registrationRetry: null };
        throw error;
      }
      if (!ciphertext.trim() || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext.trim())) {
        throw new Error('Player credential file is corrupt');
      }
      const plaintext = await runDpapi(UNPROTECT_SCRIPT, ciphertext.trim());
      let decoded: string;
      try { decoded = Buffer.from(plaintext, 'base64').toString('utf8'); }
      catch { throw new Error('Player credential file is corrupt'); }
      let state: StoredState;
      try {
        const parsed: unknown = JSON.parse(decoded);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        const value = parsed as Record<string, unknown>;
        if (value.version !== 1 || (value.token !== null && typeof value.token !== 'string') ||
            (value.registrationRetry !== null && typeof value.registrationRetry !== 'string')) throw new Error();
        state = { token: value.token as string | null, registrationRetry: value.registrationRetry as string | null };
      } catch {
        state = { token: decoded, registrationRetry: null };
      }
      if ((state.token !== null && !/^[a-f0-9]{64}$/.test(state.token)) || Buffer.from(decoded, 'utf8').toString('base64') !== plaintext) {
        throw new Error('Player credential file is corrupt');
      }
      if (state.registrationRetry !== null && !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(state.registrationRetry)) throw new Error('Player credential file is corrupt');
      return state;
  }
  async function writeState(state: StoredState): Promise<void> {
      ensureWindows();
      const serializedState = JSON.stringify({ version: 1, ...state });
      const ciphertext = await runDpapi(PROTECT_SCRIPT, Buffer.from(serializedState, 'utf8').toString('base64'));
      if (!ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext)) throw new Error('Windows DPAPI operation failed');
      const directory = path.dirname(options.filePath);
      await mkdir(directory, { recursive: true });
      const temporaryPath = path.join(directory, `.${path.basename(options.filePath)}.${randomUUID()}.tmp`);
      try { await writeFile(temporaryPath, ciphertext, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporaryPath, options.filePath); }
      finally { await rm(temporaryPath, { force: true }); }
  }

  return {
    async readToken() { return serialized(async () => (await readState()).token); },
    async writeToken(token: string) { return serialized(async () => {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid player token format');
      const state = await readState(); await writeState({ ...state, token });
    }); },
    async clearIfToken(expected: string) { return serialized(async () => {
      const state = await readState();
      if (state.token === expected) { try { await rm(options.filePath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    }); },
    async readRegistrationRetry() { return serialized(async () => (await readState()).registrationRetry); },
    async writeRegistrationRetry(value: string | null) { return serialized(async () => {
      if (value !== null && !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) throw new Error('Invalid registration retry identity');
      const state = await readState(); await writeState({ ...state, registrationRetry: value });
    }); },
    async clear() { return serialized(async () => {
      ensureWindows();
      try {
        await rm(options.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }); },
  };
}

export function createPlayerIdentityStore(options: { filePath: string; platform?: NodeJS.Platform }): PlayerIdentityStore {
  const platform = options.platform ?? process.platform;
  const ensureWindows = () => {
    if (platform !== 'win32') throw new Error('Player identity storage requires Windows DPAPI');
  };

  async function readExisting(): Promise<string> {
    const ciphertext = (await readFile(options.filePath, 'utf8')).trim();
    if (!ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext)) {
      throw new Error('Player identity file is corrupt');
    }
    let plaintext: string;
    try { plaintext = Buffer.from(await runDpapi(UNPROTECT_SCRIPT, ciphertext), 'base64').toString('utf8'); }
    catch { throw new Error('Player identity file could not be decrypted'); }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plaintext)) {
      throw new Error('Player identity file is corrupt');
    }
    return plaintext;
  }

  return {
    async getOrCreateHardwareId() {
      ensureWindows();
      try { return await readExisting(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const hardwareId = randomUUID();
      const ciphertext = await runDpapi(PROTECT_SCRIPT, Buffer.from(hardwareId, 'utf8').toString('base64'));
      if (!ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext)) {
        throw new Error('Windows DPAPI operation failed');
      }
      const directory = path.dirname(options.filePath);
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(options.filePath, ciphertext, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return hardwareId;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return readExisting();
      }
    },
  };
}
