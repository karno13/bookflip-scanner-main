import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScanToHistory, emptyOfferHistory } from './offer-history.mjs';
import { assessOffer, analyzedOffers, bookStatistics, median } from './price-analysis.mjs';

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

test('batched classification matches independent leave-one-out median for duplicate prices',()=>{
  const base = build([5000,5000,6000,6500,10000,10000,12000]);
  const ids = Object.keys(base.offers);
  base.offers[ids[5]].availability = 'unavailable';
  const fast = analyzedOffers(base);
  const byId=new Map(fast.map(offer=>[offer.id,offer]));
  for(const offer of Object.values(base.offers)){
    const others=Object.values(base.offers)
      .filter(row=>row.bookId===offer.bookId && row.currentPrice>0 &&
        row.availability!=='unavailable' && row.id!==offer.id);
    const expectedMedian=median(others.map(row=>row.currentPrice));
    const actual=byId.get(offer.id).assessment;
    assert.equal(actual.median,expectedMedian,offer.id);
    assert.equal(actual.comparableOffers,others.length,offer.id);
    assert.deepEqual(actual,assessOffer(base,offer.id),offer.id);
  }
});
test('unassigned batch analysis is linear in its result size and preserves none classification',()=>{
  const history=emptyOfferHistory();
  for(let index=0;index<1200;index++){
    const id='test:'+index;
    history.offers[id]={
      id, bookId:null, currentPrice:2500,
      originalTitle:'Unknown edition '+index,availability:'unconfirmed',
    };
  }
  const rows=analyzedOffers(history);
  assert.equal(rows.length,1200);
  assert.equal(rows[0].assessment.code,'none');
  assert.equal(rows.at(-1).assessment.median,null);
});
