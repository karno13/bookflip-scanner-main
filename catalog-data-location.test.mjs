import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultCatalogPath, backupBeforeMigrations } from './catalog-data-location.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('fresh Windows installation uses persistent LocalAppData without legacy import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookflip-fresh-'));
  try {
    const path = defaultCatalogPath({ LOCALAPPDATA: root }, 'win32');
    assert.equal(path, join(root, 'BookFlip', 'data', 'bookflip-catalog.sqlite'));
    const repo = new SqliteCatalogRepository(path);
    assert.equal(repo.counts().works, 0);
    repo.close();
    const reopened = new SqliteCatalogRepository(path);
    assert.equal(reopened.counts().works, 0);
    reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pre-upgrade backup captures SQLite and verifies integrity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookflip-upgrade-'));
  try {
    const path = join(root, 'catalog.sqlite');
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE legacy_notes(note TEXT); INSERT INTO legacy_notes VALUES('keep this data')");
    db.close();
    const backup = backupBeforeMigrations(path);
    assert.ok(backup);
    const copy = new DatabaseSync(backup, { readOnly: true });
    assert.equal(copy.prepare('SELECT note FROM legacy_notes').get().note, 'keep this data');
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    copy.close();
    assert.equal((await readdir(dirname(backup))).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
