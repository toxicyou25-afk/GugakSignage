/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, loadTlsOptions } from '../src/config.js';
import { assertManagerPasswordChanged, setSessionCookie } from '../src/auth.js';

const envNames = ['GUGAK_ROLE', 'GUGAK_MODE', 'GUGAK_TLS_CERT_FILE', 'GUGAK_TLS_KEY_FILE', 'HOST'] as const;

function withEnv(values: Partial<Record<typeof envNames[number], string>>, work: () => void): void {
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of envNames) delete process.env[name];
    Object.assign(process.env, values);
    work();
  } finally {
    for (const name of envNames) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('unconfigured bootstrap keeps all/standalone defaults', () => {
  withEnv({}, () => {
    const config = loadConfig({ databaseWasPresentAtStartup: false });
    assert.equal(config.role, 'all');
    assert.equal(config.mode, 'standalone');
    assert.equal(config.host, '0.0.0.0');
  });
});

test('Manager network modes require TLS certificate and key paths that can be loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-tls-config-'));
  try {
    const certFile = path.join(dir, 'cert.pem');
    const keyFile = path.join(dir, 'key.pem');
    fs.writeFileSync(certFile, 'certificate bytes');
    fs.writeFileSync(keyFile, 'private key bytes');
    withEnv({
      GUGAK_ROLE: 'manager', GUGAK_MODE: 'lan',
      GUGAK_TLS_CERT_FILE: certFile, GUGAK_TLS_KEY_FILE: keyFile,
    }, () => {
      const config = loadConfig({ databaseWasPresentAtStartup: false });
      assert.equal(config.role, 'manager');
      assert.equal(config.mode, 'lan');
      assert.deepEqual(loadTlsOptions(config), { cert: Buffer.from('certificate bytes'), key: Buffer.from('private key bytes') });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TLS options fail closed when a configured certificate path is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-tls-missing-'));
  try {
    withEnv({
      GUGAK_ROLE: 'manager', GUGAK_MODE: 'central',
      GUGAK_TLS_CERT_FILE: path.join(dir, 'missing-cert.pem'), GUGAK_TLS_KEY_FILE: path.join(dir, 'missing-key.pem'),
    }, () => {
      const config = loadConfig({ databaseWasPresentAtStartup: false });
      assert.throws(() => loadTlsOptions(config), /ENOENT/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bootstrap rejects invalid role/mode combinations and remote HTTP Manager binding', () => {
  const invalid: Array<Record<string, string>> = [
    { GUGAK_ROLE: 'unknown' },
    { GUGAK_MODE: 'remote' },
    { GUGAK_ROLE: 'all', GUGAK_MODE: 'lan' },
    { GUGAK_ROLE: 'all', GUGAK_MODE: 'central' },
    { GUGAK_ROLE: 'manager', GUGAK_MODE: 'lan' },
  ];
  for (const values of invalid) withEnv(values, () => assert.throws(() => loadConfig(), /GUGAK_|TLS|HTTPS|loopback/i));
  withEnv({ GUGAK_ROLE: 'manager', GUGAK_MODE: 'standalone', HOST: '0.0.0.0' }, () => {
    assert.throws(() => loadConfig(), /loopback/i);
  });
  withEnv({ GUGAK_ROLE: 'player', GUGAK_MODE: 'lan' }, () => {
    assert.equal(loadConfig({ databaseWasPresentAtStartup: false }).role, 'player');
  });
});

test('session cookie secure flag follows the explicit HTTPS mode argument', () => {
  const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const response = { cookie: (name: string, value: string, options: Record<string, unknown>) => calls.push({ name, value, options }) };
  setSessionCookie(response as never, 'test-secret');
  setSessionCookie(response as never, 'test-secret', '0', true);
  assert.equal(calls[0]?.options.secure, false);
  assert.equal(calls[1]?.options.secure, true);
});

test('Manager network bootstrap refuses the stored test default password', () => {
  assert.throws(() => assertManagerPasswordChanged(true), /test default/i);
  assert.doesNotThrow(() => assertManagerPasswordChanged(false));
});
