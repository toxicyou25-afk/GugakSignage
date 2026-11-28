// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, run, type DB } from './db.js';

const inFlightBackfills = new WeakMap<DB, Promise<{ updated: number; skipped: number }>>();
const backfilledRows = new WeakMap<DB, WeakSet<object>>();

export function sha256Buffer(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => { hash.update(chunk); });
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

export function backfillContentChecksums(db: DB, uploadDir: string): Promise<{ updated: number; skipped: number }> {
  const existing = inFlightBackfills.get(db);
  if (existing) return existing;
  const completed = backfilledRows.get(db) ?? new WeakSet<object>();
  if (completed.has(db)) return Promise.resolve({ updated: 0, skipped: 0 });
  const operation = runBackfillContentChecksums(db, uploadDir)
    .then((result) => { if (result.skipped === 0) completed.add(db); return result; })
    .finally(() => inFlightBackfills.delete(db));
  inFlightBackfills.set(db, operation);
  backfilledRows.set(db, completed);
  return operation;
}

async function runBackfillContentChecksums(db: DB, uploadDir: string): Promise<{ updated: number; skipped: number }> {
  const pending = all<{ id: string; stored_name: string }>(
    db,
    'SELECT id, stored_name FROM contents WHERE checksum IS NULL AND stored_name IS NOT NULL AND kind IN (?, ?)',
    'image',
    'video',
  );
  let updated = 0;
  let skipped = 0;
  for (const content of pending) {
    if (path.basename(content.stored_name) !== content.stored_name) {
      skipped += 1;
      continue;
    }
    const filePath = path.join(path.resolve(uploadDir), content.stored_name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) { skipped += 1; continue; }
      const checksum = await sha256File(filePath);
      updated += run(db, 'UPDATE contents SET checksum = ? WHERE id = ? AND checksum IS NULL', checksum, content.id).changes;
    } catch {
      // Preserve unreadable legacy media and leave its checksum unset.
      skipped += 1;
    }
  }
  return { updated, skipped };
}
