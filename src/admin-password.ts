/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import { getMeta, setMeta, transaction, type DB } from './db.js';
import type { AppConfig } from './config.js';

const PASSWORD_HASH_KEY = 'admin_password_hash';
const DEFAULT_PASSWORD_MARKER_KEY = 'admin_password_is_test_default';
const SESSION_EPOCH_KEY = 'admin_session_epoch';
const LEGACY_SESSION_EPOCH = '0';
// Preserve the pre-feature default only for an existing database with no stored credential or environment value.
const LEGACY_ADMIN_PASSWORD = 'gugak1234';
export const TEST_DEFAULT_ADMIN_PASSWORD = '0000';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function passwordMatchesHash(encoded: string | undefined, supplied: string): boolean {
  if (!encoded) return false;
  const [algorithm, saltText, hashText, ...extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText || extra.length > 0) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_BYTES) return false;
    const actual = crypto.scryptSync(supplied, salt, expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function initializeAdminPassword(db: DB, config: AppConfig): void {
  transaction(db, () => {
    if (getMeta(db, PASSWORD_HASH_KEY) === undefined) {
      const initialPassword = config.adminPassword || (config.databaseWasPresentAtStartup
        ? LEGACY_ADMIN_PASSWORD
        : TEST_DEFAULT_ADMIN_PASSWORD);
      setMeta(db, PASSWORD_HASH_KEY, hashPassword(initialPassword));
      setMeta(db, DEFAULT_PASSWORD_MARKER_KEY, initialPassword === TEST_DEFAULT_ADMIN_PASSWORD ? '1' : '0');
    } else if (getMeta(db, DEFAULT_PASSWORD_MARKER_KEY) === undefined) {
      setMeta(db, DEFAULT_PASSWORD_MARKER_KEY, verifyAdminPassword(db, TEST_DEFAULT_ADMIN_PASSWORD) ? '1' : '0');
    }
    if (getMeta(db, SESSION_EPOCH_KEY) === undefined) {
      setMeta(db, SESSION_EPOCH_KEY, LEGACY_SESSION_EPOCH);
    }
    const isMarkedTestDefault = getMeta(db, DEFAULT_PASSWORD_MARKER_KEY) === '1';
    const configuredBootstrapPassword = config.adminPassword;
    if (config.mode !== 'standalone' && isMarkedTestDefault &&
        configuredBootstrapPassword && configuredBootstrapPassword.trim() &&
        configuredBootstrapPassword !== TEST_DEFAULT_ADMIN_PASSWORD) {
      setMeta(db, PASSWORD_HASH_KEY, hashPassword(configuredBootstrapPassword));
      setMeta(db, DEFAULT_PASSWORD_MARKER_KEY, '0');
      setMeta(db, SESSION_EPOCH_KEY, crypto.randomUUID());
    }
  });
}

export function adminSessionEpoch(db: DB): string {
  return getMeta(db, SESSION_EPOCH_KEY) ?? LEGACY_SESSION_EPOCH;
}

export function verifyAdminPassword(db: DB, supplied: string): boolean {
  return passwordMatchesHash(getMeta(db, PASSWORD_HASH_KEY), supplied);
}

export function usesTestDefaultAdminPassword(db: DB): boolean {
  const marker = getMeta(db, DEFAULT_PASSWORD_MARKER_KEY);
  if (marker !== undefined) return marker === '1';
  const isDefault = verifyAdminPassword(db, TEST_DEFAULT_ADMIN_PASSWORD);
  setMeta(db, DEFAULT_PASSWORD_MARKER_KEY, isDefault ? '1' : '0');
  return isDefault;
}

export function changeAdminPassword(db: DB, currentPassword: string, newPassword: string): boolean {
  if (!verifyAdminPassword(db, currentPassword)) return false;
  const newHash = hashPassword(newPassword);
  let changed = false;
  transaction(db, () => {
    if (!verifyAdminPassword(db, currentPassword)) return;
    setMeta(db, PASSWORD_HASH_KEY, newHash);
    setMeta(db, DEFAULT_PASSWORD_MARKER_KEY, newPassword === TEST_DEFAULT_ADMIN_PASSWORD ? '1' : '0');
    setMeta(db, SESSION_EPOCH_KEY, crypto.randomUUID());
    changed = true;
  });
  return changed;
}
