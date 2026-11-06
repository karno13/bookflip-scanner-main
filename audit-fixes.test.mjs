import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { availableCatalogMigrations, applyCatalogMigrations } from './catalog-migrations.mjs';
import { listCatalogWorks, listCatalogOffers, listIdentificationJobs } from './catalog-api.mjs';
import { readJson, catalogHistorySnapshot } from './local-app.mjs';
import { allBookStatistics, bookStatistics } from './price-analysis.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';

test('failed COMMIT restores depth and subsequent nested transactions remain atomic', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    repo.database.exec('CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)');
    assert.throws(() => repo.transaction(() => repo.database.exec('INSERT INTO c VALUES(1)')), /FOREIGN KEY/);
    assert.equal(repo.depth, 0);
    assert.throws(() => repo.transaction(() => {
      repo.transaction(() => repo.createWork({ title: 'Rollback' }));
      throw Error('OUTER_FAILED');
    }), /OUTER_FAILED/);
    assert.equal(repo.counts().works, 0);
    repo.transaction(() => repo.transaction(() => repo.createWork({ title: 'Kept' })));
    assert.equal(repo.depth, 0);
    assert.equal(repo.counts().works, 1);
  } finally { repo.close(); }
});

test('Polish case and canonical Unicode work in catalog, authors, offers and review search', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    repo.createWork({ title: 'ŻABA ŁÓDŹ ŚWIT', authors: ['ŁUCJA ĆWIK'] });
    repo.upsertOffer({ id: 'o', source: 'test', normalizedUrl: 'https://example.com/o', originalTitle: 'ŻABA ŁÓDŹ ŚWIT', currentPrice: 1000 });
    repo.putIdentificationJob({ offerId: 'o', status: 'review_required' });
    for (const query of ['ŻABA', 'żaba', 'łódź', 'świt', 'żaba'.normalize('NFD')]) {
      assert.equal(listCatalogWorks(repo, { query }).total, 1, query);
      assert.equal(listCatalogOffers(repo, { query }).total, 1, query);
      assert.equal(listIdentificationJobs(repo, { query }).total, 1, query);
    }
    assert.equal(listCatalogWorks(repo, { query: 'łucja ćwik' }).total, 1);
    assert.equal(listCatalogWorks(repo, { query: '%' }).total, 0);
  } finally { repo.close(); }
});

test('JSON reader preserves UTF-8 split at every byte and keeps its byte limit', async () => {
  const input = { title: 'Żółć, Łódź i Świt 📚' };
  const bytes = Buffer.from(JSON.stringify(input));
  assert.deepEqual(await readJson(Readable.from([...bytes].map(byte => Buffer.from([byte])))), input);
  await assert.rejects(readJson(Readable.from([Buffer.alloc(32769)])), { message: 'REQUEST_TOO_LARGE', statusCode: 413 });
  await assert.rejects(readJson(Readable.from([Buffer.from('{')])), { message: 'INVALID_JSON' });
});

test('versioned review rebuild backs up old schema, retains records and immutable triggers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-review-upgrade-'));
  const path = join(directory, 'old.sqlite');
  let db;
  let repo;
  try {
    db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT UNIQUE,checksum TEXT,applied_at TEXT) STRICT');
    for (const migration of availableCatalogMigrations().filter(row => row.version < 103)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version, migration.name, migration.checksum, '2026-01-01');
    }
    db.exec("INSERT INTO offers(id,source,normalized_url,created_at,updated_at) VALUES('o','test','https://example.com/o','now','now'); INSERT INTO review_decisions(id,offer_id,action,created_at) VALUES('d','o','not_book','now')");
    db.close(); db = null;
    repo = new SqliteCatalogRepository(path);
    assert.equal(repo.database.prepare('SELECT action FROM review_decisions WHERE id=?').get('d').action, 'not_book');
    repo.database.exec("INSERT INTO review_decisions(id,offer_id,action,created_at) VALUES('e','o','excluded','now')");
    assert.throws(() => repo.database.exec("UPDATE review_decisions SET reason='changed'"), /IMMUTABLE/);
    assert.deepEqual(applyCatalogMigrations(repo.database), []);
    assert.equal(repo.database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(repo.database.prepare('PRAGMA foreign_key_check').all().length, 0);
    const backups = readdirSync(join(directory, 'backups'));
    assert.equal(backups.length, 1);
    db = new DatabaseSync(join(directory, 'backups', backups[0]), { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=103').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM review_decisions').get().n, 1);
  } finally { db?.close(); repo?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('batch statistics equal individual statistics with unavailable and unassigned offers', () => {
  const history = { version: 2, books: { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } }, offers: {
    x: { id: 'x', bookId: 'a', currentPrice: 200, availability: 'unconfirmed' },
    y: { id: 'y', bookId: 'a', currentPrice: 400, availability: 'unavailable' },
    z: { id: 'z', bookId: 'b', currentPrice: 500 },
    u: { id: 'u', bookId: null, currentPrice: 10 },
  }, priceHistory: [{ offerId: 'x', price: 100 }, { offerId: 'y', price: 50 }, { offerId: 'u', price: 1 }], details: {} };
  assert.deepEqual(allBookStatistics(history), Object.keys(history.books).map(id => bookStatistics(history, id)));
});

test('failed migration integrity check rolls back schema and version before restoring foreign keys', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT UNIQUE,checksum TEXT,applied_at TEXT) STRICT');
    for (const migration of availableCatalogMigrations().filter(row => row.version < 103)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version, migration.name, migration.checksum, 'now');
    }
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO review_decisions(id,offer_id,action,created_at) VALUES('broken','missing','not_book','now'); PRAGMA foreign_keys=ON");
    assert.throws(() => applyCatalogMigrations(db), /MIGRATION_FK_FAILED/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=103').get().n, 0);
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='review_decisions'").get().sql.includes("'excluded'"), false);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM review_decisions').get().n, 1);
  } finally { db.close(); }
});

test('migration accepts databases previously expanded by the runtime and records its version', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    repo.database.exec('DELETE FROM schema_migrations WHERE version=103');
    const before = repo.database.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='review_decisions' ORDER BY name").all();
    assert.deepEqual(applyCatalogMigrations(repo.database), [103]);
    assert.deepEqual(repo.database.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='review_decisions' ORDER BY name").all(), before);
  } finally { repo.close(); }
});

test('SQL-reduced history snapshot preserves book statistics, prices and reassignment semantics', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({ title: 'Snapshot' });
    const edition = repo.createEdition({ workId: work.id, title: 'Snapshot' });
    const other = repo.createEdition({ workId: work.id, title: 'Other edition' });
    for (let i = 0; i < 3; i++) {
      const offer = repo.upsertOffer({ source: 'test', normalizedUrl: `https://example.com/${i}`, originalTitle: 'Book', currentPrice: 1000 + i * 100 });
      repo.assignOfferToEdition(offer.id, edition.id, { method: 'manual', status: 'active' });
      repo.appendPriceObservation(offer.id, 100 + i * 100, '2026-01-01');
      repo.appendPriceObservation(offer.id, 1000 + i * 100, '2026-01-02');
      if (i === 0) repo.assignOfferToEdition(offer.id, other.id, { method: 'manual', status: 'active' });
    }
    const history = sqliteHistoryModel(repo);
    const expected = allBookStatistics(history).sort((a, b) => a.book.id.localeCompare(b.book.id));
    const snapshot = catalogHistorySnapshot(repo);
    assert.deepEqual(snapshot.books.sort((a, b) => a.book.id.localeCompare(b.book.id)), expected);
    assert.equal(snapshot.offers.length, 3);
  } finally { repo.close(); }
});
