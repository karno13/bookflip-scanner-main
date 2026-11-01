import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupCatalog } from './backup-catalog.mjs';

test('backup creates a consistent SQLite copy and refuses overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bookflip-backup-'));
  try {
    const source = join(dir, 'source.sqlite');
    const destination = join(dir, 'backup.sqlite');
    const db = new DatabaseSync(source);
    db.exec('CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES (\'saved\')');
    db.close();
    assert.equal(await backupCatalog({ source, destination }), destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT value FROM sample').get().value, 'saved');
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { copy.close(); }
    await assert.rejects(backupCatalog({ source, destination }), /BACKUP_ALREADY_EXISTS/);
    await assert.rejects(backupCatalog({ source, destination: source }), /BACKUP_SOURCE_EQUALS_DESTINATION/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
