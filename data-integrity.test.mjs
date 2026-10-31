import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProductionCatalog } from './catalog-production.mjs';
import { availableCatalogMigrations, applyCatalogMigrations } from './catalog-migrations.mjs';
import { withHistoryWriteLock } from './local-app.mjs';

test('history write lock executes one mutation at a time even when calls overlap', async () => {
  const events = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const a = withHistoryWriteLock(async () => {
    events.push('a-start');
    await gate;
    events.push('a-end');
  });
  const b = withHistoryWriteLock(async () => {
    events.push('b-start');
    events.push('b-end');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['a-start']);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end']);
});
test('SQLite offer price history records changes, not repeated same-price scans', () => {
  const catalog = createProductionCatalog({ databasePath: ':memory:' });
  try {
    const item = {
      source: 'fixture',
      url: 'https://example.test/listing/change',
      title: 'Book',
      price: 240,
    };
    catalog.ingestOffers([item], new Date('2026-01-01T12:00:00Z'));
    catalog.ingestOffers([item], new Date('2026-01-02T12:00:00Z'));
    catalog.ingestOffers([{ ...item, price: 275 }], new Date('2026-01-03T12:00:00Z'));
    const history = catalog.repository.database
      .prepare('SELECT price FROM offer_price_history ORDER BY observed_at')
      .all();
    assert.deepEqual(
      history.map((row) => row.price),
      [240, 275],
    );
    assert.equal(
      catalog.repository.database.prepare('SELECT seen_count FROM offers LIMIT 1').get().seen_count,
      3,
    );
  } finally {
    catalog.close();
  }
});
test('migration checksum accepts equivalent CRLF but rejects different content', () => {
  const catalog = createProductionCatalog({ databasePath: ':memory:' });
  try {
    const row = availableCatalogMigrations()[0];
    const crlf = createHash('sha256').update(row.sql.replace(/\n/g, '\r\n')).digest('hex');
    catalog.repository.database
      .prepare('UPDATE schema_migrations SET checksum=? WHERE version=?')
      .run(crlf, row.version);
    assert.deepEqual(applyCatalogMigrations(catalog.repository.database), []);
    catalog.repository.database
      .prepare('UPDATE schema_migrations SET checksum=? WHERE version=?')
      .run('tampered', row.version);
    assert.throws(
      () => applyCatalogMigrations(catalog.repository.database),
      /MIGRATION_CHECKSUM_MISMATCH/,
    );
  } finally {
    catalog.close();
  }
});
