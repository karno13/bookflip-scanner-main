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

export function assessOffer(raw, offerId, config = PRICE_CLASSIFICATION) {
  const history = migrateOfferHistory(raw),
    offer = history.offers[offerId];
  if (!offer?.bookId || !offer.currentPrice)
    return {
      label: 'Brak oceny',
      code: 'none',
      reason: 'Za mało danych do oceny',
      median: null,
      differencePercent: null,
      comparableOffers: 0,
    };
  const comparable = currentOffers(history, offer.bookId).filter((row) => row.id !== offer.id),
    benchmark = median(comparable.map((row) => row.currentPrice));
  if (comparable.length < config.minimumComparableOffers || !benchmark)
    return {
      label: 'Brak oceny',
      code: 'none',
      reason: 'Za mało danych do oceny',
      median: benchmark,
      differencePercent: null,
      comparableOffers: comparable.length,
    };
  const difference = ((offer.currentPrice - benchmark) / benchmark) * 100,
    discount = -difference;
  let label, code;
  if (discount >= config.dealDiscount) {
    label = 'Okazja';
    code = 'deal';
  } else if (discount >= config.goodDiscount) {
    label = 'Dobra cena';
    code = 'good';
  } else if (Math.abs(difference) <= config.marketRange) {
    label = 'Cena rynkowa';
    code = 'market';
  } else if (difference > config.marketRange) {
    label = 'Drogo';
    code = 'expensive';
  } else {
    label = 'Cena rynkowa';
    code = 'market';
  }
  return {
    label,
    code,
    reason: null,
    median: benchmark,
    differencePercent: Math.round(difference * 10) / 10,
    comparableOffers: comparable.length,
  };
}

export function analyzedOffers(raw, ids = null) {
  const history = migrateOfferHistory(raw),
    selected = ids ? new Set(ids) : null;
  return Object.values(history.offers)
    .filter((offer) => !selected || selected.has(offer.id))
    .map((offer) => ({
      ...offer,
      price: offer.currentPrice,
      assessment: assessOffer(history, offer.id),
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
