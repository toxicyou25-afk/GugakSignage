/* SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';

export function loadLocalEnv(
  filePath = process.env.GUGAK_ENV_FILE || path.resolve(process.cwd(), '.env'),
): boolean {
  if (!fs.existsSync(filePath)) return false;
  process.loadEnvFile(filePath);
  return true;
}
