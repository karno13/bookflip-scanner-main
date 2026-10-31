import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { compareHistoryStores } from './history-parity.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE offers (id TEXT, source TEXT, normalized_url TEXT, current_price INTEGER, seen_count INTEGER);
 CREATE TABLE offer_price_history (id INTEGER PRIMARY KEY,offer_id TEXT,price INTEGER,observed_at TEXT);
 CREATE TABLE editions (id TEXT PRIMARY KEY,legacy_id TEXT);
 CREATE TABLE offer_matches (id TEXT PRIMARY KEY,offer_id TEXT,edition_id TEXT,status TEXT);`);
  return db;
}
function history(offers, priceHistory = []) {
  return {
    version: 2,
    offers: Object.fromEntries(offers.map((item) => [item.id, item])),
    priceHistory,
  };
}
const offer = {
  id: 'Vinted:123',
  source: 'Vinted',
  url: 'https://www.vinted.pl/items/123-book?utm_source=x',
  currentPrice: 2200,
  seenCount: 3,
};

test('parity gate accepts identical normalized URL without changing SQLite', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'Vinted:123',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    const before = db.prepare('SELECT * FROM offers').all();
    const result = compareHistoryStores(history([offer]), db);
    assert.equal(result.safeToCutOver, true);
    assert.equal(result.summary.matched, 1);
    assert.deepEqual(db.prepare('SELECT * FROM offers').all(), before);
  } finally {
    db.close();
  }
});
test('parity flags missing offers and prices, without claiming SQLite-only rows are lost', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'Vinted:123',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2600,
      4,
    );
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'extra',
      'OLX',
      'https://www.olx.pl/d/oferta/extra',
      1000,
      1,
    );
    const other = {
      ...offer,
      id: 'OLX:5',
      source: 'OLX',
      url: 'https://www.olx.pl/d/oferta/missing',
    };
    const report = compareHistoryStores(history([offer, other]), db);
    assert.equal(report.safeToCutOver, false);
    assert.equal(report.summary.priceDifferences, 1);
    assert.equal(report.summary.missingInSqlite, 1);
    assert.equal(report.summary.sqliteOnly, 1);
    assert.equal(report.summary.seenCountDifferences, 1);
  } finally {
    db.close();
  }
});
test('parity does not guess when SQLite contains ambiguous source URLs', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'a',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'b',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    const report = compareHistoryStores(history([offer]), db);
    assert.equal(report.safeToCutOver, false);
    assert.equal(report.summary.ambiguousMatches, 1);
    assert.equal(report.samples.ambiguousMatches.length, 1);
  } finally {
    db.close();
  }
});
test('invalid JSON URLs fail the migration gate and errors are bounded', () => {
  const db = fixture();
  try {
    const report = compareHistoryStores(history([{ ...offer, url: 'not a url' }]), db, {
      sampleLimit: 0,
    });
    assert.equal(report.safeToCutOver, false);
    assert.equal(report.summary.invalidJsonUrls, 1);
    assert.deepEqual(report.samples.invalidJsonUrls, []);
    assert.throws(
      () => compareHistoryStores(history([]), db, { sampleLimit: 101 }),
      /INVALID_SAMPLE_LIMIT/,
    );
  } finally {
    db.close();
  }
});

test('all legacy price observations must survive in SQLite before cutover', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'Vinted:123',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    db.prepare('INSERT INTO offer_price_history(offer_id,price,observed_at) VALUES(?,?,?)').run(
      'Vinted:123',
      2200,
      '2026-10-02T10:00:00Z',
    );
    const points = [
      { offerId: 'Vinted:123', price: 1800, observedAt: '2026-10-01T10:00:00Z' },
      { offerId: 'Vinted:123', price: 2200, observedAt: '2026-10-02T10:00:00Z' },
    ];
    const report = compareHistoryStores(history([offer], points), db);
    assert.equal(report.safeToCutOver, false);
    assert.equal(report.summary.pricePointsMissing, 1);
    assert.deepEqual(report.samples.pricePointsMissing[0], {
      offerId: 'Vinted:123',
      price: 1800,
      observedAt: '2026-10-01T10:00:00Z',
    });
    db.prepare('INSERT INTO offer_price_history(offer_id,price,observed_at) VALUES(?,?,?)').run(
      'Vinted:123',
      1800,
      '2026-10-01T10:00:00Z',
    );
    assert.equal(compareHistoryStores(history([offer], points), db).safeToCutOver, true);
  } finally {
    db.close();
  }
});
test('SQLite-only price points are reported but do not erase older JSON observations', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'Vinted:123',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    db.prepare('INSERT INTO offer_price_history(offer_id,price,observed_at) VALUES(?,?,?)').run(
      'Vinted:123',
      2200,
      '2026-10-03T10:00:00Z',
    );
    const result = compareHistoryStores(history([offer]), db);
    assert.equal(result.summary.extraSqlitePricePoints, 1);
    assert.equal(result.safeToCutOver, true);
  } finally {
    db.close();
  }
});
test('manual links must point to the exact legacy book, not just any edition', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run(
      'Vinted:123',
      'Vinted',
      'https://www.vinted.pl/items/123-book',
      2200,
      3,
    );
    const manual = { ...offer, bookId: 'book:one', linkMode: 'manual' };
    assert.equal(compareHistoryStores(history([manual]), db).summary.manualMatchesMissing, 1);
    db.prepare('INSERT INTO editions VALUES (?,?)').run('edition-two', 'book:two');
    db.prepare('INSERT INTO offer_matches VALUES (?,?,?,?)').run(
      'm',
      'Vinted:123',
      'edition-two',
      'active',
    );
    const conflict = compareHistoryStores(history([manual]), db);
    assert.equal(conflict.summary.manualMatchesConflicting, 1);
    assert.equal(conflict.safeToCutOver, false);
    db.prepare('INSERT INTO editions VALUES (?,?)').run('edition-one', 'book:one');
    db.prepare("UPDATE offer_matches SET edition_id='edition-one' WHERE id='m'").run();
    assert.equal(compareHistoryStores(history([manual]), db).safeToCutOver, true);
  } finally {
    db.close();
  }
});
test('malformed historical price points block cutover rather than being ignored', () => {
  const db = fixture();
  try {
    const report = compareHistoryStores(
      history([], [{ offerId: 'missing', price: -1, observedAt: 'bad' }]),
      db,
    );
    assert.equal(report.safeToCutOver, false);
    assert.equal(report.summary.invalidJsonPricePoints, 1);
  } finally {
    db.close();
  }
});
