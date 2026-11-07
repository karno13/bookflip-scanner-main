import assert from 'node:assert/strict';
import test from 'node:test';
import { completeResults, markUnseenOffers } from './offer-availability.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const T1 = '2026-11-01T10:00:00.000Z';
const T2 = '2026-11-05T10:00:00.000Z';

function offer(repo, n, queries, at, availability = 'unconfirmed') {
  return repo.upsertOffer({
    source: 'Vinted',
    normalizedUrl: `https://www.vinted.pl/items/${n}`,
    originalTitle: 'T' + n,
    currentPrice: 1000,
    matchedQueries: queries,
    availability,
    firstSeenAt: at,
    lastSeenAt: at,
    at,
  });
}
const status = (repo, n) =>
  repo.database.prepare('SELECT availability FROM offers WHERE normalized_url=?').get(`https://www.vinted.pl/items/${n}`).availability;
const complete = { source: 'Vinted', query: 'Warcraft', status: 'ok', pagination: { state: 'end' } };

test('only a finished, successful scan counts as evidence that an offer is gone', () => {
  assert.equal(completeResults([complete]).length, 1);
  assert.equal(completeResults([{ ...complete, status: 'partial' }]).length, 0);
  assert.equal(completeResults([{ ...complete, pagination: { state: 'more' } }]).length, 0);
  assert.equal(completeResults([{ ...complete, pagination: undefined }]).length, 0);
});

test('offers missing from a complete scan of their phrase are marked, seen ones are not', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  offer(repo, 1, ['Warcraft'], T1);
  offer(repo, 2, ['Warcraft'], T1);
  offer(repo, 3, ['Warhammer'], T1);
  offer(repo, 2, ['Warcraft'], T2); // still listed in the latest scan
  assert.equal(markUnseenOffers(repo.database, [complete], T2), 1);
  assert.deepEqual([status(repo, 1), status(repo, 2), status(repo, 3)], ['not_seen', 'unconfirmed', 'unconfirmed']);
});

test('an incomplete scan never marks anything, and a re-seen offer returns to unconfirmed', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  offer(repo, 1, ['Warcraft'], T1);
  assert.equal(markUnseenOffers(repo.database, [{ ...complete, pagination: { state: 'unknown' } }], T2), 0);
  assert.equal(markUnseenOffers(repo.database, [complete], T2), 1);
  assert.equal(status(repo, 1), 'not_seen');
  offer(repo, 1, ['Warcraft'], '2026-11-06T10:00:00.000Z'); // listed again
  assert.equal(status(repo, 1), 'unconfirmed');
});
