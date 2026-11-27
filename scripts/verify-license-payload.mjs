/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(process.argv[2]);
const payload = path.resolve(process.argv[3]);
const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'));
const audit = fs.readFileSync(path.join(payload, 'docs/legal/dependency-licenses.md'), 'utf8');
const notice = fs.readFileSync(path.join(payload, 'NOTICE'), 'utf8');
for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE', 'docs/legal/dependency-licenses.md']) {
  const source = fs.readFileSync(path.join(repo, file));
  const packaged = fs.readFileSync(path.join(payload, file));
  assert.deepEqual(packaged, source, `payload copy differs from source: ${file}`);
}
const names = ['LICENSE', 'LICENCE', 'COPYING', 'COPYRIGHT', 'NOTICE', 'LICENSE.md', 'LICENSE.txt'];
const packages = Object.entries(lock.packages).filter(([key, entry]) => key && !entry.dev);
let licenseFiles = 0;
const failures = [];

for (const [lockPath, entry] of packages) {
  const name = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const key = `${name}@${entry.version}`;
  const row = audit.split(/\r?\n/u).find((line) => line.startsWith(`| \`${key}\` |`));
  const packageDir = path.join(payload, lockPath);
  if (!row) { failures.push(`${key}: missing audit row`); continue; }
  if (!fs.existsSync(packageDir)) { failures.push(`${key}: missing from production payload`); continue; }
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  if (manifest.version !== entry.version) failures.push(`${key}: payload version ${manifest.version}`);
  const originalFiles = names.filter((file) => fs.existsSync(path.join(packageDir, file)));
  if (originalFiles.length) {
    for (const file of originalFiles) {
      const absolute = path.join(packageDir, file);
      const rel = path.relative(payload, absolute).replaceAll('\\', '/');
      const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      if (!row.includes(`${rel}=${digest}`)) failures.push(`${key}: packaged ${file} hash differs from audit`);
      licenseFiles++;
    }
    continue;
  }
  if (name === 'cookie-signature' && entry.version === '1.0.7') {
    const file = path.join(packageDir, 'Readme.md');
    const readme = fs.readFileSync(file, 'utf8');
    const section = readme.match(/^## License\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/mu)?.[1];
    if (!section) { failures.push(`${key}: missing full MIT text in Readme.md`); continue; }
    const bytes = Buffer.from(section.replaceAll('\r\n', '\n').trim() + '\n', 'utf8');
    const rel = `${path.relative(payload, file).replaceAll('\\', '/')} § License`;
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!row.includes(`${rel}=${digest}`)) failures.push(`${key}: packaged Readme license hash differs from audit`);
    licenseFiles++;
    continue;
  }
  failures.push(`${key}: no original LICENSE/NOTICE file in production payload`);
}

assert.ok(notice.includes('docs/legal/dependency-licenses.md'), 'payload NOTICE does not point to its dependency inventory');
assert.ok(fs.existsSync(path.join(payload, 'LICENSE')), 'payload has no project LICENSE');
assert.ok(fs.existsSync(path.join(payload, 'docs/legal/dependency-licenses.md')), 'payload has no dependency license inventory');
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`Verified ${packages.length} Windows production packages, ${licenseFiles} original license/notice text files, top-level LICENSE/NOTICE, and matching audit hashes.`);
