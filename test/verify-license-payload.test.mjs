/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedLicenseHash = '9771dacd324f4cf3b07fa7f302b790517f0c82c2f91e15631c2124f070910471';

test('verifies the complete cookie-signature MIT license block in a production payload', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-license-payload-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const repo = path.join(temporaryRoot, 'repo');
  const payload = path.join(temporaryRoot, 'payload');
  const packageDir = path.join(payload, 'node_modules', 'cookie-signature');
  fs.mkdirSync(path.join(repo, 'docs', 'legal'), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });

  const readme = fs.readFileSync(path.join(root, 'node_modules', 'cookie-signature', 'Readme.md'));
  const readmeText = readme.toString('utf8');
  const sectionStart = readmeText.search(/^## License\s*\r?\n/mu);
  assert.notEqual(sectionStart, -1, 'cookie-signature README has a License section');
  const contentStart = readmeText.indexOf('\n', sectionStart) + 1;
  const nextHeading = readmeText.slice(contentStart).search(/^## /mu);
  const section = nextHeading < 0 ? readmeText.slice(contentStart) : readmeText.slice(contentStart, contentStart + nextHeading);
  const licenseBytes = Buffer.from(section.replaceAll('\r\n', '\n').trim() + '\n', 'utf8');
  assert.equal(crypto.createHash('sha256').update(licenseBytes).digest('hex'), expectedLicenseHash);

  fs.writeFileSync(path.join(packageDir, 'Readme.md'), readme);
  const lock = { packages: { 'node_modules/cookie-signature': { version: '1.0.7' } } };
  fs.writeFileSync(path.join(repo, 'package-lock.json'), JSON.stringify(lock));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ version: '1.0.7' }));
  const audit = `| \`cookie-signature@1.0.7\` | package-lock.json | transitive | MIT | Windows production payload | \`node_modules/cookie-signature/Readme.md § License\` | author | \`node_modules/cookie-signature/Readme.md § License=${expectedLicenseHash}\` |\n`;
  fs.mkdirSync(path.join(payload, 'docs', 'legal'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'legal', 'dependency-licenses.md'), audit);
  fs.writeFileSync(path.join(payload, 'docs', 'legal', 'dependency-licenses.md'), audit);
  fs.writeFileSync(path.join(repo, 'NOTICE'), 'See docs/legal/dependency-licenses.md\n');
  fs.writeFileSync(path.join(payload, 'NOTICE'), 'See docs/legal/dependency-licenses.md\n');
  fs.writeFileSync(path.join(repo, 'LICENSE'), 'project license\n');
  fs.writeFileSync(path.join(payload, 'LICENSE'), 'project license\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(payload, 'package.json'), '{}');
  fs.copyFileSync(path.join(repo, 'package-lock.json'), path.join(payload, 'package-lock.json'));

  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-license-payload.mjs'), repo, payload], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /matching audit hashes/);
});
