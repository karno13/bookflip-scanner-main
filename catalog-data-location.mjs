import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { availableCatalogMigrations } from './catalog-migrations.mjs';

export function defaultCatalogPath(env = process.env, platform = process.platform) {
  if (env.BOOKFLIP_CATALOG_DB) return env.BOOKFLIP_CATALOG_DB;
  const root = platform === 'win32'
    ? (env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : (env.XDG_DATA_HOME || join(homedir(), '.local', 'share'));
  return join(root, 'BookFlip', 'data', 'bookflip-catalog.sqlite');
}

export function backupBeforeMigrations(path) {
  if (path === ':memory:' || !existsSync(path)) return null;
  const check = new DatabaseSync(path, { readOnly: true });
  check.exec('PRAGMA busy_timeout=10000');
  let needsUpgrade;
  try {
    const exists = check.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const applied = exists
      ? new Set(check.prepare('SELECT version FROM schema_migrations').all().map(row => Number(row.version)))
      : new Set();
    needsUpgrade = availableCatalogMigrations().some(row => !applied.has(row.version));
  } finally {
    check.close();
  }
  if (!needsUpgrade) return null;
  const backupScript = new URL('./scripts/backup-catalog.mjs', import.meta.url);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(dirname(path), 'backups', basename(path, '.sqlite') + '-pre-migration-' + timestamp + '-' + process.pid + '.sqlite');
  const result = spawnSync(process.execPath, [fileURLToPath(backupScript), destination], {
    env: { ...process.env, BOOKFLIP_CATALOG_DB: path }, encoding: 'utf8',
  });
  if (result.status !== 0) throw Error('PRE_MIGRATION_BACKUP_FAILED: ' + (result.stderr || result.error?.message || 'unknown'));
  return destination;
}

