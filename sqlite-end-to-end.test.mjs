import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductionCatalog } from './catalog-production.mjs';
import { searchOffers, createLocalAppServer } from './local-app.mjs';
import { createSqliteBook, persistSqliteScan } from './sqlite-single-store.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';

// Entire offline fixture: marketplace discovery -> real scan normalization ->
// transactional SQLite ingest -> real ISBN worker -> SQLite projection ->
// HTTP API serialization. No marketplace or metadata network calls.
test('offline discovery, ISBN identification, historical prices and HTTP history survive restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-e2e-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'bookflip.sqlite');
  const firstAt = '2026-10-31T12:00:00.000Z',
    secondAt = '2026-10-31T13:00:00.000Z';
  const isbn = '9780306406157';
  const url = 'https://www.empik.com/fixture-book,p1,ksiazka-p?utm_source=test';
  const oldDb = process.env.BOOKFLIP_CATALOG_DB,
    oldStorage = process.env.BOOKFLIP_STORAGE;
  process.env.BOOKFLIP_CATALOG_DB = dbPath;
  process.env.BOOKFLIP_STORAGE = 'sqlite';
  t.after(() => {
    if (oldDb === undefined) delete process.env.BOOKFLIP_CATALOG_DB;
    else process.env.BOOKFLIP_CATALOG_DB = oldDb;
    if (oldStorage === undefined) delete process.env.BOOKFLIP_STORAGE;
    else process.env.BOOKFLIP_STORAGE = oldStorage;
  });
  let catalog = createProductionCatalog({
    databasePath: dbPath,
    fetcher: async () => {
      throw Error('UNEXPECTED_EXTERNAL_NETWORK');
    },
  });
  try {
    const book = createSqliteBook(catalog, { title: 'Theoretical Physics', isbn });
    assert.ok(book.created);
    const scans = [];
    for (const [at, price] of [
      [firstAt, 2990],
      [secondAt, 2490],
    ]) {
      const discovered = await searchOffers(
        { queries: ['Theoretical Physics'], sources: ['Empik'] },
        {
          now: () => new Date(at),
          scanner: async (task) => {
            assert.equal(task.source, 'Empik');
            return {
              offers: [{ source: 'Empik', url, title: 'Theoretical Physics', isbn, price }],
              pagination: { state: 'end' },
            };
          },
        },
      );
      assert.equal(discovered.summary.offers, 1);
      scans.push(
        persistSqliteScan(catalog, {
          offers: discovered.offers,
          searchedAt: discovered.searchedAt,
          errors: [],
        }),
      );
    }
    assert.equal(scans[0].summary.newOffers, 1);
    assert.equal(scans[1].summary.priceChanges, 1);
    const jobs = catalog.repository.database
      .prepare('SELECT status FROM identification_jobs')
      .all();
    assert.equal(jobs.length, 1);
    const processed = await catalog.processQueued(5);
    assert.equal(processed.failed, 0);
    assert.equal(processed.processed, 1);
    assert.equal(
      catalog.repository.database.prepare('SELECT status FROM identification_jobs LIMIT 1').get()
        .status,
      'completed',
    );
    const history = sqliteHistoryModel(catalog.repository);
    assert.equal(Object.keys(history.offers).length, 1);
    assert.equal(history.priceHistory.length, 2);
    assert.deepEqual(
      history.priceHistory.map((point) => point.price),
      [2990, 2490],
    );
    assert.equal(Object.values(history.offers)[0].seenCount, 2);
    assert.equal(Object.values(history.offers)[0].bookId, book.book.id);
    assert.equal(history.lastScan.priceChanges, 1);
  } finally {
    catalog.close();
  }
  // Reopen the file as a separate connection: the HTTP layer must consume
  // persisted SQLite rows rather than in-process state or legacy JSON.
  const server = createLocalAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const historyResponse = await fetch(base + '/api/history');
    assert.equal(historyResponse.status, 200);
    const snapshot = await historyResponse.json();
    assert.equal(snapshot.lastScan.at, secondAt);
    assert.equal(snapshot.lastScan.priceChanges, 1);
    assert.equal(snapshot.offers.length, 1);
    assert.equal(snapshot.offers[0].currentPrice, 2490);
    assert.equal(snapshot.books.length, 1);
    assert.equal(snapshot.books[0].uniqueOffers, 1);
    const details = await fetch(
      base + '/api/book?id=' + encodeURIComponent(snapshot.books[0].book.id),
    );
    assert.equal(details.status, 200);
    const book = await details.json();
    assert.equal(book.priceHistory.length, 2);
    assert.equal(book.historicalMinimum, 2490);
    const offers = await fetch(base + '/api/offers');
    assert.equal(offers.status, 200);
    assert.ok(existsSync(dbPath));
    assert.equal(existsSync(join(directory, 'local-offer-history.json')), false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('ISBN without verified evidence is not attached to an arbitrary edition', async () => {
  const catalog = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw Error('UNEXPECTED_NETWORK');
    },
  });
  try {
    const discovered = await searchOffers(
      { queries: ['Ambiguous book'], sources: ['Empik'] },
      {
        now: () => new Date('2026-10-31T12:00:00Z'),
        scanner: async () => ({
          offers: [
            {
              source: 'Empik',
              url: 'https://www.empik.com/ambiguous,p2,ksiazka-p',
              title: 'Ambiguous book',
              price: 1600,
            },
          ],
          pagination: { state: 'end' },
        }),
      },
    );
    const saved = persistSqliteScan(catalog, {
      offers: discovered.offers,
      searchedAt: discovered.searchedAt,
    });
    assert.equal(saved.summary.newOffers, 1);
    const report = await catalog.processQueued(5);
    assert.equal(report.failed, 0);
    const history = sqliteHistoryModel(catalog.repository);
    assert.equal(Object.values(history.offers)[0].bookId, null);
    assert.equal(
      catalog.repository.database.prepare('SELECT status FROM identification_jobs LIMIT 1').get()
        .status,
      'review_required',
    );
  } finally {
    catalog.close();
  }
});
