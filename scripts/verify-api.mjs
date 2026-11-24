// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'test/api.test.ts', 'test/env.test.ts'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env },
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
process.stdout.write(output);
const outputDir = path.join(root, 'docs', 'verification');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'api-test-output.txt'), output, 'utf8');
process.exit(result.status ?? 1);
