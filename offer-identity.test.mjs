import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyOffer, normalizeOfferUrl, sourceOfferId } from './offer-identity.mjs';
import {
  applyScanToHistory,
  createCatalogBook,
  emptyOfferHistory,
  linkOfferToBook,
} from './offer-history.mjs';

const isbn = '9780306406157',
  other = '9780140328721';
const base = {
  source: 'Example',
  title: 'Książka',
  price: 1200,
  url: 'https://example.test/offers/book',
};

test('URL normalization removes known tracking but preserves and sorts identity parameters', () => {
  const normalized = normalizeOfferUrl(
    'https://EXAMPLE.test//offers/7/?variant=hardcover&utm_source=newsletter&item=42&fbclid=x#photo',
  );
  assert.equal(normalized, 'https://example.test/offers/7?item=42&variant=hardcover');
  assert.equal(
    sourceOfferId('Example', 'https://example.test/offers/7?item=42'),
    sourceOfferId('Example', 'https://example.test/offers/7?utm_medium=email&item=42'),
  );
  assert.notEqual(
    sourceOfferId('Example', 'https://example.test/offers/7?item=42'),
    sourceOfferId('Example', 'https://example.test/offers/7?item=43'),
  );
});

test('explicit marketplace IDs take priority and existing path-based IDs remain compatible', () => {
  assert.equal(
    identifyOffer({
      source: 'Example',
      url: 'https://example.test/old-url',
      externalOfferId: 'abc-7',
    }).id,
    'Example:abc-7',
  );
  assert.equal(
    sourceOfferId('Vinted', 'https://www.vinted.pl/items/123-book?utm_campaign=x'),
    'Vinted:123',
  );
  assert.equal(sourceOfferId('Empik', 'https://www.empik.com/book,p987,ksiazka-p'), 'Empik:987');
});

test('labelled description ISBN links an offer but an unlabelled value does not', () => {
  const labelled = applyScanToHistory(
    emptyOfferHistory(),
    [{ ...base, description: `ISBN: ${isbn}` }],
    '2026-10-30T10:00:00Z',
  ).history;
  assert.equal(labelled.offers['Example:https://example.test/offers/book'].bookId, `isbn:${isbn}`);
  const unlabelled = applyScanToHistory(
    emptyOfferHistory(),
    [{ ...base, description: `Numer ${isbn}` }],
    '2026-10-30T10:00:00Z',
  ).history;
  assert.equal(unlabelled.offers['Example:https://example.test/offers/book'].bookId, null);
  assert.equal(Object.keys(unlabelled.books).length, 0);
});

test('conflicting ISBNs never create an automatic link, even with a cached detail', () => {
  const history = emptyOfferHistory();
  history.details[base.url] = { isbn, checkedAt: '2026-10-30T09:00:00Z' };
  const result = applyScanToHistory(
    history,
    [{ ...base, description: `ISBN: ${isbn}; ISBN: ${other}` }],
    '2026-10-30T10:00:00Z',
  ).history;
  assert.equal(result.offers['Example:https://example.test/offers/book'].bookId, null);
  assert.equal(result.offers['Example:https://example.test/offers/book'].isbn, null);
  assert.equal(Object.keys(result.books).length, 0);
});

test('manual assignment stays authoritative when later evidence conflicts', () => {
  const scanned = applyScanToHistory(emptyOfferHistory(), [base], '2026-10-30T08:00:00Z').history;
  const created = createCatalogBook(
    scanned,
    { title: 'Ręcznie wybrana książka' },
    '2026-10-30T08:10:00Z',
    () => 'manual-1',
  );
  const linked = linkOfferToBook(
    created.history,
    'Example:https://example.test/offers/book',
    'book:manual-1',
    '2026-10-30T08:20:00Z',
  );
  const rescanned = applyScanToHistory(
    linked,
    [{ ...base, description: `ISBN: ${isbn}; ISBN: ${other}` }],
    '2026-10-30T10:00:00Z',
  ).history;
  assert.equal(
    rescanned.offers['Example:https://example.test/offers/book'].bookId,
    'book:manual-1',
  );
  assert.equal(rescanned.offers['Example:https://example.test/offers/book'].linkMode, 'manual');
});

test('an explicit ID does not duplicate an offer already stored under its legacy URL ID', () => {
  const first = applyScanToHistory(emptyOfferHistory(), [base], '2026-10-30T08:00:00Z').history;
  const second = applyScanToHistory(
    first,
    [{ ...base, externalOfferId: 'external-7' }],
    '2026-10-30T09:00:00Z',
  ).history;
  assert.equal(Object.keys(second.offers).length, 1);
  assert.ok(second.offers['Example:https://example.test/offers/book']);
  assert.equal(second.offers['Example:https://example.test/offers/book'].seenCount, 2);
});
