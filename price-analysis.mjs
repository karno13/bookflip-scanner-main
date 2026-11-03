import { migrateOfferHistory } from './offer-history.mjs';

export const PRICE_CLASSIFICATION = {
  minimumComparableOffers: 2,
  dealDiscount: 30,
  goodDiscount: 15,
  marketRange: 15,
};

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function currentOffers(history, bookId) {
  return Object.values(history.offers).filter(
    (offer) =>
      offer.bookId === bookId && offer.currentPrice > 0 && offer.availability !== 'unavailable',
  );
}

export function bookStatistics(raw, bookId) {
  const history = migrateOfferHistory(raw),
    book = history.books[bookId];
  if (!book) return null;
  const offers = currentOffers(history, bookId),
    prices = offers.map((offer) => offer.currentPrice),
    ids = new Set(
      Object.values(history.offers)
        .filter((offer) => offer.bookId === bookId)
        .map((offer) => offer.id),
    ),
    historical = history.priceHistory
      .filter((point) => ids.has(point.offerId))
      .map((point) => point.price);
  return {
    book,
    currentOffers: offers.length,
    uniqueOffers: ids.size,
    lowestCurrent: prices.length ? Math.min(...prices) : null,
    averageCurrent: prices.length
      ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length)
      : null,
    medianCurrent: median(prices),
    historicalMinimum: historical.length ? Math.min(...historical) : null,
  };
}

function emptyAssessment() {
  return {
    label: 'Brak oceny', code: 'none', reason: 'Za mało danych do oceny',
    median: null, differencePercent: null, comparableOffers: 0,
  };
}

// Prepare current, active comparables once per edition/book. Reuse their
// sorted order to calculate leave-one-out medians in O(1) per assessed offer.
function buildComparables(history, bookIds) {
  const grouped = new Map();
  for (const offer of Object.values(history.offers)) {
    if (!bookIds.has(offer.bookId) || !(offer.currentPrice > 0) ||
        offer.availability === 'unavailable') continue;
    if (!grouped.has(offer.bookId)) grouped.set(offer.bookId, []);
    grouped.get(offer.bookId).push(offer);
  }
  const prepared = new Map();
  for (const [bookId, offers] of grouped) {
    offers.sort((a,b) => a.currentPrice - b.currentPrice);
    prepared.set(bookId, {
      offers,
      indexes: new Map(offers.map((item,index) => [item.id,index])),
    });
  }
  return prepared;
}
function assessPrepared(offer, prepared, config = PRICE_CLASSIFICATION) {
  if (!offer?.bookId || !offer.currentPrice) return emptyAssessment();
  const group = prepared.get(offer.bookId);
  const sorted = group?.offers || [];
  const removed = group?.indexes.get(offer.id) ?? -1;
  const count = sorted.length - (removed >= 0 ? 1 : 0);
  const nth = index => sorted[index + (removed >= 0 && index >= removed ? 1 : 0)].currentPrice;
  const middle = Math.floor(count / 2);
  const benchmark = !count ? null : count % 2 ? nth(middle) :
    (nth(middle - 1) + nth(middle)) / 2;
  if (count < config.minimumComparableOffers || !benchmark)
    return {
      label: 'Brak oceny', code: 'none', reason: 'Za mało danych do oceny',
      median: benchmark, differencePercent: null, comparableOffers: count,
    };
  const difference = ((offer.currentPrice - benchmark) / benchmark) * 100;
  const discount = -difference;
  let label, code;
  if (discount >= config.dealDiscount) {
    label = 'Okazja'; code = 'deal';
  } else if (discount >= config.goodDiscount) {
    label = 'Dobra cena'; code = 'good';
  } else if (Math.abs(difference) <= config.marketRange) {
    label = 'Cena rynkowa'; code = 'market';
  } else if (difference > config.marketRange) {
    label = 'Drogo'; code = 'expensive';
  } else {
    label = 'Cena rynkowa'; code = 'market';
  }
  return {
    label, code, reason: null, median: benchmark,
    differencePercent: Math.round(difference * 10) / 10,
    comparableOffers: count,
  };
}
export function assessOffer(raw, offerId, config = PRICE_CLASSIFICATION) {
  const history = migrateOfferHistory(raw);
  const offer = history.offers[offerId];
  if (!offer?.bookId || !offer.currentPrice) return emptyAssessment();
  const prepared = buildComparables(history, new Set([offer.bookId]));
  return assessPrepared(offer, prepared, config);
}
export function analyzedOffers(raw, ids = null) {
  const history = migrateOfferHistory(raw),
    selected = ids ? new Set(ids) : null;
  const offers = Object.values(history.offers)
    .filter(offer => !selected || selected.has(offer.id));
  const books = new Set(offers.map(offer => offer.bookId).filter(Boolean));
  const prepared = books.size ? buildComparables(history, books) : new Map();
  return offers.map(offer => ({
    ...offer,
    price: offer.currentPrice,
    assessment: assessPrepared(offer, prepared),
  }));
}

export function bookHistory(raw, bookId) {
  const history = migrateOfferHistory(raw),
    statistics = bookStatistics(history, bookId);
  if (!statistics) return null;
  const offers = analyzedOffers(history)
      .filter((offer) => offer.bookId === bookId)
      .sort((a, b) => a.currentPrice - b.currentPrice),
    ids = new Set(offers.map((offer) => offer.id)),
    priceHistory = history.priceHistory
      .filter((point) => ids.has(point.offerId))
      .sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  return { ...statistics, offers, priceHistory };
}
