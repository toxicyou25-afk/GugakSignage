/* SPDX-License-Identifier: Apache-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { imageSize } from 'image-size';
import { loadConfig } from '../src/config.js';
import { openDatabase, get, run } from '../src/db.js';
import { seedDatabase, seedSummary } from '../src/seed.js';

const rootDir = path.resolve(import.meta.dirname, '..');

test('seed와 프로토타입 샘플에 특정 기관명이 남지 않는다', () => {
  const files = [
    'seed/source/poster-autumn.svg',
    'seed/source/poster-class.svg',
    'seed/source/poster-welcome.svg',
    'src/seed.ts',
    'prototype/README.md',
    'prototype/ATTRIBUTION.md',
    'prototype/app.js',
  ];
  for (const file of files) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    assert.doesNotMatch(content, /국립부산국악원|부산국악원|부산/, `${file} contains an institution-specific name`);
    assert.doesNotMatch(content, /예시 기관/, `${file} retains an institution-bound sample label`);
  }
});

test('seed PNG dimensions match the SVG poster variants', () => {
  const expected = {
    'poster-autumn.png': { width: 1920, height: 1080 },
    'poster-class.png': { width: 1920, height: 1080 },
    'poster-welcome.png': { width: 1080, height: 1920 },
  };
  for (const [file, dimensions] of Object.entries(expected)) {
    const { width, height } = imageSize(fs.readFileSync(path.join(rootDir, 'seed', file)));
    assert.deepEqual({ width, height }, dimensions, file);
  }
});

test('first-run sample seeding preserves existing user rows and colliding upload bytes', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-seed-preservation-'));
  const uploadDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const userBytes = Buffer.from('existing user image bytes');
  fs.writeFileSync(path.join(uploadDir, 'seed-poster-welcome.png'), userBytes);
  fs.writeFileSync(path.join(uploadDir, 'user-upload.png'), userBytes);

  const config = loadConfig({
    rootDir,
    dataDir: tempDir,
    dbPath: path.join(tempDir, 'signage.sqlite'),
    uploadDir,
    seedSamples: true,
  });
  const db = openDatabase(config.dbPath);
  t.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const createdAt = '2026-11-26T00:00:00.000Z';
  run(
    db,
    'INSERT INTO contents(id, name, kind, mime, stored_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    'user-content-1', '사용자 업로드', 'image', 'image/png', 'user-upload.png', createdAt,
  );

  const seeded = seedDatabase(db, config);
  assert.equal(seeded.seeded, true);
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, 'seed-poster-welcome.png')), userBytes);
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, 'user-upload.png')), userBytes);
  const savedUserContent = get<{ id: string; name: string; stored_name: string }>(
    db,
    'SELECT id, name, stored_name FROM contents WHERE id = ?',
    'user-content-1',
  );
  assert.equal(savedUserContent?.id, 'user-content-1');
  assert.equal(savedUserContent?.name, '사용자 업로드');
  assert.equal(savedUserContent?.stored_name, 'user-upload.png');

  const summary = seedSummary(db);
  assert.equal(seedDatabase(db, config).seeded, false);
  assert.deepEqual(seedSummary(db), summary);
});

test('sample seeding skips a database that existed before server startup even when SEED_SAMPLES=true', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugak-existing-db-'));
  const dbPath = path.join(tempDir, 'signage.sqlite');
  const uploadDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const userBytes = Buffer.from('existing production upload bytes');
  fs.writeFileSync(path.join(uploadDir, 'user-upload.png'), userBytes);

  const existingDb = openDatabase(dbPath);
  const createdAt = '2026-11-26T00:00:00.000Z';
  run(
    existingDb,
    'INSERT INTO contents(id, name, kind, mime, stored_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    'user-content-existing', '기존 운영 자료', 'image', 'image/png', 'user-upload.png', createdAt,
  );
  existingDb.close();

  const config = loadConfig({
    rootDir,
    dataDir: tempDir,
    dbPath,
    uploadDir,
    seedSamples: true,
  });
  assert.equal(config.databaseWasPresentAtStartup, true);
  const db = openDatabase(dbPath);
  t.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const beforeSummary = seedSummary(db);
  const seeded = seedDatabase(db, config);
  assert.equal(seeded.seeded, false);
  assert.equal(seeded.deviceId, undefined);
  assert.deepEqual(seedSummary(db), beforeSummary);
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, 'user-upload.png')), userBytes);
  assert.equal(fs.existsSync(path.join(uploadDir, 'seed-poster-autumn.png')), false);
  const savedUserContent = get<{ id: string }>(db, 'SELECT id FROM contents WHERE id = ?', 'user-content-existing');
  assert.equal(savedUserContent?.id, 'user-content-existing');
});
