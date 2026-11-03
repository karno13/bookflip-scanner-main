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
  const db = catalog.repository.database;
  const previous = db.prepare('SELECT current_price FROM offers WHERE id=?');
  const scanOffers = offers.filter(
    offer => offer?.source && offer?.url && Number.isSafeInteger(offer.price) && offer.price > 0,
  );
  const ids = [];
  let newOffers = 0, priceChanges = 0;
  const seen = new Set();
  for (const offer of scanOffers) {
    try {
      const id = sourceOfferId(offer.source, offer.url, offerExternalId(offer));
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      const old = previous.get(id);
      if (!old) newOffers++;
      else if (old.current_price !== offer.price) priceChanges++;
    } catch {}
  }
  const lastScan = { at, found: offers.length, newOffers, priceChanges, errors };
  const ingest = catalog.ingestOffers(scanOffers, at, { scanSummary: lastScan });

  // Do not materialize the entire catalog (or its complete price-history table).
  // Price classifications depend only on CURRENT offers for the same edition.
  const linked = db.prepare(`SELECT COALESCE(e.legacy_id,w.legacy_id,'edition:' || e.id) AS book_id
    FROM offer_matches m JOIN editions e ON e.id=m.edition_id
    JOIN works w ON w.id=e.work_id
    WHERE m.offer_id=? AND m.status='active' LIMIT 1`);
  const current = db.prepare('SELECT * FROM offers WHERE id=?');
  const byBook = new Map();
  const unmatched = {version:2, books:{}, offers:{}, priceHistory:[], details:{},lastScan};
  const ordered = [];
  for (const id of ids) {
    const row = current.get(id);
    if (!row) continue;
    const link = linked.get(id);
    if (link?.book_id) {
      if (!byBook.has(link.book_id))
        byBook.set(link.book_id, sqliteHistoryModel(catalog.repository, {
          bookId: link.book_id, includePriceHistory: false,
        }));
      ordered.push({id, bookId: link.book_id});
    } else {
      let matchedQueries = [];
      try { matchedQueries = JSON.parse(row.matched_queries_json || '[]'); }
      catch {}
      unmatched.offers[id] = {
        id, bookId:null, linkMode:null, originalTitle:row.original_title,
        currentPrice:row.current_price, source:row.source, url:row.normalized_url,
        firstSeenAt:row.first_seen_at, lastSeenAt:row.last_seen_at,
        availability:row.availability, matchedQueries:Array.isArray(matchedQueries)?matchedQueries:[],
        isbn:row.observed_isbn || null, language:row.language || null, seenCount:row.seen_count,
      };
      ordered.push({id, bookId:null});
    }
  }
  const unassigned = new Map(analyzedOffers(unmatched).map(item => [item.id,item]));
  const analyses = new Map();
  for (const [bookId, model] of byBook) {
    const relevant = ordered.filter(row => row.bookId === bookId).map(row => row.id);
    for (const item of analyzedOffers(model, relevant)) analyses.set(item.id,item);
  }
  const analyzed = ordered.map(({id,bookId}) => bookId ? analyses.get(id) : unassigned.get(id))
    .filter(Boolean).map(item => ({...item,title:item.originalTitle}));
  return {
    ingest, offers:analyzed, lastScan,
    summary:{newOffers,priceChanges},
    history:{saved:db.prepare('SELECT count(*) AS total FROM offers').get().total,
      new:newOffers,priceChanges},
  };
}
