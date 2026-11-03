import { DatabaseSync } from 'node:sqlite';
import { copyFile, link, mkdir, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function verifyCatalogBackup(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw Error('BACKUP_INTEGRITY_CHECK_FAILED');
    const required = ['works','editions','offers','schema_migrations'];
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    if (required.some(name => !names.has(name))) throw Error('INVALID_BOOKFLIP_BACKUP');
    return { valid: true, tables: names.size };
  } finally { db.close(); }
}

// Restore to an explicit NEW destination only. Never replace a running catalog.
// Link a verified temporary copy atomically: link() fails if destination exists.
export async function restoreCatalog({ source, destination } = {}) {
  if (typeof source !== 'string' || typeof destination !== 'string' ||
      !source.trim() || !destination.trim()) throw Error('RESTORE_PATHS_REQUIRED');
  const input = resolve(source), output = resolve(destination);
  if (input === output) throw Error('RESTORE_SOURCE_EQUALS_DESTINATION');
  try {
    await lstat(output);
    throw Error('RESTORE_DESTINATION_EXISTS');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  verifyCatalogBackup(input);
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await copyFile(input, temporary, constants.COPYFILE_EXCL);
    verifyCatalogBackup(temporary);
    await link(temporary, output);
    return output;
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restoreCatalog({source:process.argv[2],destination:process.argv[3]})
    .then(path => console.log('Zweryfikowana kopia odzyskana do:',path))
    .catch(error => {console.error('Przywracanie nie powiodło się:',error.message);process.exitCode=1;});
}
