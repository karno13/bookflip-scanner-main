import { randomUUID } from 'node:crypto';
import { normalizedIsbn } from './offer-history.mjs';
import { sourceOfferId, offerExternalId } from './offer-identity.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';
import { analyzedOffers } from './price-analysis.mjs';

export function storageMode(env = process.env) {
  const mode = String(env.BOOKFLIP_STORAGE || 'sqlite').toLowerCase();
  if (mode !== 'sqlite') throw Error('SQLITE_ONLY_STORAGE_MODE');
  return mode;
}

function bad(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}
function bookFromProjection(catalog, bookId) {
  return sqliteHistoryModel(catalog.repository).books[bookId] || null;
}
export function createSqliteBook(catalog, { title, isbn = null } = {}) {
  const clean = String(title || '').trim(),
    rawIsbn = String(isbn || '').trim(),
    cleanIsbn = normalizedIsbn(rawIsbn);
  if (!clean || clean.length > 500) bad('INVALID_BOOK_TITLE');
  if (rawIsbn && !cleanIsbn) bad('INVALID_BOOK_ISBN');
  const repo = catalog.repository,
    at = new Date().toISOString();
  let bookId,
    created = false;
  repo.transaction(() => {
    if (cleanIsbn) {
      const existing = repo.database
        .prepare(
          "SELECT e.legacy_id,e.id FROM edition_identifiers i JOIN editions e ON e.id=i.edition_id WHERE i.scheme IN ('isbn10','isbn13') AND i.normalized_value=? LIMIT 1",
        )
        .get(cleanIsbn);
      if (existing) {
        bookId = existing.legacy_id || 'edition:' + existing.id;
        return;
      }
    }
    bookId = 'book:' + randomUUID();
    const work = repo.createWork({
      legacyId: bookId,
      title: clean,
      verificationStatus: 'manual',
      at,
    });
    const edition = repo.createEdition({
      legacyId: bookId,
      workId: work.id,
      title: clean,
      verificationStatus: 'manual',
      at,
    });
    if (cleanIsbn)
      repo.attachIdentifier(edition.id, cleanIsbn.length === 10 ? 'isbn10' : 'isbn13', cleanIsbn, {
        source: 'local_manual',
        verificationStatus: 'manual',
        at,
      });
    created = true;
  });
  return { book: bookFromProjection(catalog, bookId), created };
}

export function linkSqliteOffer(catalog, { offerId, bookId } = {}) {
  const repo = catalog.repository,
    db = repo.database;
  const offer = db
    .prepare('SELECT id FROM offers WHERE id=? OR legacy_id=? LIMIT 1')
    .get(String(offerId || ''), String(offerId || ''));
  if (!offer) bad('OFFER_NOT_FOUND', 404);
  const key = String(bookId || ''),
    edition = key.startsWith('edition:')
      ? db.prepare('SELECT id FROM editions WHERE id=?').get(key.slice(8))
      : db.prepare('SELECT id FROM editions WHERE legacy_id=?').get(key);
  if (!edition) bad('BOOK_NOT_FOUND', 404);
  repo.transaction(() => {
    const current = db
      .prepare(
        "SELECT edition_id,method FROM offer_matches WHERE offer_id=? AND status='active' LIMIT 1",
      )
      .get(offer.id);
    if (current?.edition_id === edition.id && ['manual', 'legacy_manual'].includes(current.method))
      return;
    repo.assignOfferToEdition(offer.id, edition.id, {
      method: 'manual',
      status: 'active',
      createdBy: 'local_user',
    });
  });
  return sqliteHistoryModel(repo);
}

export function persistSqliteScan(catalog, { offers, searchedAt, errors = [] }) {
  const at = String(searchedAt);
  // Compare only identities and prices; rebuilding the entire history (including
  // every price observation) before each scan grows with the lifetime of the catalog.
  const previous = new Map(
    catalog.repository.database
      .prepare('SELECT id,current_price FROM offers')
      .all()
      .map((row) => [row.id, row.current_price]),
  );
  const scanOffers = offers.filter(
    (offer) => offer?.source && offer?.url && Number.isSafeInteger(offer.price) && offer.price > 0,
  );
  let newOffers = 0,
    priceChanges = 0;
  const ids = [];
  for (const offer of scanOffers) {
    try {
      const id = sourceOfferId(offer.source, offer.url, offerExternalId(offer));
      ids.push(id);
      if (!previous.has(id)) newOffers++;
      else if (previous.get(id) !== offer.price) priceChanges++;
    } catch {}
  }
  const lastScan = { at, found: offers.length, newOffers, priceChanges, errors };
  const ingest = catalog.ingestOffers(scanOffers, at, { scanSummary: lastScan });
  const updated = sqliteHistoryModel(catalog.repository);
  const observedIds = ids.filter((id) => updated.offers[id]);
  const analyzed = analyzedOffers(updated, observedIds).map((offer) => ({
    ...offer,
    title: offer.originalTitle,
  }));
  return {
    ingest,
    offers: analyzed,
    lastScan,
    summary: { newOffers, priceChanges },
    history: { saved: Object.keys(updated.offers).length, new: newOffers, priceChanges },
  };
}
