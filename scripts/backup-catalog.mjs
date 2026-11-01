import { defaultCatalogPath } from '../catalog-data-location.mjs';
import { backup, DatabaseSync } from 'node:sqlite';
import { access, mkdir, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSource = defaultCatalogPath();

export async function backupCatalog({
  source = process.env.BOOKFLIP_CATALOG_DB || defaultSource,
  destination,
} = {}) {
  const input = resolve(source);
  await access(input, constants.R_OK);
  const output = resolve(
    destination || join(dirname(input), 'backups', basename(input, extname(input)) + '-' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite'),
  );
  if (input === output) throw Error('BACKUP_SOURCE_EQUALS_DESTINATION');
  await mkdir(dirname(output), { recursive: true });
  // Never overwrite an existing backup and never expose an incomplete copy.
  try {
    await access(output);
    throw Error('BACKUP_ALREADY_EXISTS');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = output + '.' + process.pid + '.tmp';
  const db = new DatabaseSync(input, { readOnly: true });
  try {
    await backup(db, temp);
    const check = new DatabaseSync(temp, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
        throw Error('BACKUP_INTEGRITY_CHECK_FAILED');
    } finally {
      check.close();
    }
    await rename(temp, output);
    return output;
  } finally {
    db.close();
    await unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backupCatalog({ destination: process.argv[2] })
    .then((path) => console.log('Backup SQLite:', path))
    .catch((error) => { console.error('Backup failed:', error.message); process.exitCode = 1; });
}
