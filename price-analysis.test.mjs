import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScanToHistory, emptyOfferHistory } from './offer-history.mjs';
import { assessOffer, bookStatistics, median } from './price-analysis.mjs';

const isbn = '9788388916014';
function build(prices) {
  const offers = prices.map((price, index) => ({
    source: 'Vinted',
    url: `https://www.vinted.pl/items/${index + 1}-book`,
    title: 'Dzień smoka',
    price,
    isbn,
    availability: 'unconfirmed',
  }));
  return applyScanToHistory(emptyOfferHistory(), offers, '2026-10-29T10:00:00Z').history;
}

test('median handles odd and even sets without counting observations twice', () => {
  assert.equal(median([100, 300, 200]), 200);
  assert.equal(median([100, 200, 300, 400]), 250);
  assert.equal(median([]), null);
});

test('book statistics use unique offers and retain historical minimum', () => {
  const first = build([6000, 10000, 10000]),
    second = applyScanToHistory(
      first,
      [
        {
          source: 'Vinted',
          url: 'https://www.vinted.pl/items/1-book',
          title: 'Dzień smoka',
          price: 5000,
          isbn,
          availability: 'unconfirmed',
        },
      ],
      '2026-11-02T10:00:00Z',
    ).history,
    stats = bookStatistics(second, `isbn:${isbn}`);
  assert.equal(stats.currentOffers, 3);
  assert.equal(stats.uniqueOffers, 3);
  assert.equal(stats.lowestCurrent, 5000);
  assert.equal(stats.averageCurrent, 8333);
  assert.equal(stats.medianCurrent, 10000);
  assert.equal(stats.historicalMinimum, 5000);
});

test('deal classification excludes the assessed offer from its median', () => {
  const history = build([6000, 10000, 10000]),
    deal = assessOffer(history, 'Vinted:1'),
    expensive = assessOffer(history, 'Vinted:2');
  assert.equal(deal.label, 'Okazja');
  assert.equal(deal.median, 10000);
  assert.equal(deal.differencePercent, -40);
  assert.equal(expensive.label, 'Drogo');
  assert.equal(expensive.median, 8000);
});

test('offers without ISBN or enough comparables receive no categorical rating', () => {
  const one = build([5000, 6000]),
    assessment = assessOffer(one, 'Vinted:1'),
    unlinked = applyScanToHistory(
      emptyOfferHistory(),
      [
        {
          source: 'OLX',
          url: 'https://www.olx.pl/d/oferta/book-IDabc.html',
          title: 'Książka',
          price: 5000,
          availability: 'unconfirmed',
        },
      ],
      '2026-10-29T10:00:00Z',
    ).history;
  assert.equal(assessment.label, 'Brak oceny');
  assert.equal(assessment.reason, 'Za mało danych do oceny');
  assert.equal(assessOffer(unlinked, 'OLX:abc').label, 'Brak oceny');
});
