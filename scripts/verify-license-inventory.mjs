/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] ?? process.cwd());
const auditPath = path.join(rootDir, 'docs', 'legal', 'dependency-licenses.md');
const audit = fs.readFileSync(auditPath, 'utf8');
const auditRows = new Map(
  [...audit.matchAll(/^\| `([^`]+)` \|([^\r\n]*)/gmu)].map((match) => [`${match[1]}`, `| ${match[1]} |${match[2]}`]),
);
const lockFiles = ['package-lock.json', 'prototype/package-lock.json'];
const locked = new Map();
const licenseFiles = ['LICENSE', 'LICENCE', 'COPYING', 'COPYRIGHT', 'NOTICE', 'LICENSE.md', 'LICENSE.txt'];
let windowsProductionEntries = 0;

function packageName(lockPath) {
  const marker = 'node_modules/';
  return lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertRecordedText(row, relPath, bytes) {
  const expected = `${relPath}=${hash(bytes)}`;
  assert.ok(row.includes(expected), `Audit does not record the current license text hash: ${expected}`);
}

function extractMarkdownSection(text, title) {
  const heading = new RegExp(`^## ${title}[ \\t]*\\r?\\n`, 'gmu').exec(text);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const nextHeading = /^## [^\r\n]*[ \t]*$/gmu;
  nextHeading.lastIndex = start;
  const next = nextHeading.exec(text);
  return text.slice(start, next ? next.index : text.length).replace(/\r\n?/gu, '\n').trim() + '\n';
}

for (const lockFile of lockFiles) {
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, lockFile), 'utf8'));
  const baseDir = path.dirname(lockFile);
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (!lockPath) continue;
    const name = packageName(lockPath);
    const key = `${name}@${entry.version}`;
    assert.ok(auditRows.has(key), `Missing license audit row for ${lockFile}: ${key}`);
    const row = auditRows.get(key);
    locked.set(key, (locked.get(key) ?? 0) + 1);

    if (lockFile.startsWith('prototype/')) continue;
    if (!entry.dev) windowsProductionEntries++;

    const packageDir = path.join(rootDir, baseDir, lockPath);
    if (!fs.existsSync(packageDir)) {
      if (name.startsWith('@esbuild/')) {
        const sharedPath = path.join(rootDir, 'node_modules', 'esbuild', 'LICENSE.md');
        const rel = path.relative(rootDir, sharedPath).replaceAll('\\', '/');
        assertRecordedText(row, rel, fs.readFileSync(sharedPath));
      } else if (name === 'fsevents' && entry.optional) {
        assert.match(row, /fsevents@2\.3\.3 package\/LICENSE=[0-9a-f]{64}/u);
      } else {
        assert.ok(entry.optional, `Required locked package is not installed: ${key}`);
      }
      continue;
    }

    const originals = licenseFiles.filter((file) => fs.existsSync(path.join(packageDir, file)));
    if (originals.length) {
      for (const file of originals) {
        const absolute = path.join(packageDir, file);
        const rel = path.relative(rootDir, absolute).replaceAll('\\', '/');
        assertRecordedText(row, rel, fs.readFileSync(absolute));
      }
      continue;
    }

    if (name === 'cookie-signature' && entry.version === '1.0.7') {
      const readme = fs.readFileSync(path.join(packageDir, 'Readme.md'), 'utf8');
      const section = extractMarkdownSection(readme, 'License');
      assert.ok(section, 'cookie-signature full MIT license section is missing');
      const bytes = Buffer.from(section, 'utf8');
      const rel = `${path.relative(rootDir, path.join(packageDir, 'Readme.md')).replaceAll('\\', '/')} § License`;
      assertRecordedText(row, rel, bytes);
      continue;
    }

    if (name.startsWith('@esbuild/')) {
      const sharedPath = path.join(rootDir, 'node_modules', 'esbuild', 'LICENSE.md');
      const rel = path.relative(rootDir, sharedPath).replaceAll('\\', '/');
      assertRecordedText(row, rel, fs.readFileSync(sharedPath));
      continue;
    }

    throw new Error(`Installed package has no original LICENSE/NOTICE evidence: ${key}`);
  }
}

for (const key of auditRows.keys()) {
  assert.ok(locked.has(key), `Stale package row no longer exists in either lockfile: ${key}`);
}

assert.equal(auditRows.size, locked.size, 'Audit row count must equal unique package@version count');
assert.doesNotMatch(audit, /UNVERIFIED|not present in lock metadata|미확인/u);
assert.equal(windowsProductionEntries, 75, 'Production dependency count changed; update audit scope and distribution notes');

console.log(`License audit matches ${locked.size} unique package@version records across ${lockFiles.length} lockfiles; ${windowsProductionEntries} Windows production entries.`);
