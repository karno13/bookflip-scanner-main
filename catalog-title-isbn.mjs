import { isbnCandidates } from './metadata-record.mjs';
import { isbnKeys } from './isbn-normalization.mjs';

// One candidate per edition: an ISBN-10 and its ISBN-13 are the same book, keep the 13-digit form.
function distinctEditions(values, max = 3) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const keys = isbnKeys(value);
    const canonical = keys.find((key) => key.length === 13) ?? value;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= max) break;
  }
  return out;
}

// This is discovery only. Never create or assign editions from a title search:
// the same work can have many editions, translations and ISBNs.
export async function findTitleIsbnCandidates(
  rawTitle,
  { requestBn, requestOpenLibrary } = {},
) {
  const title = String(rawTitle ?? '').trim().slice(0, 160);
  if (title.length < 4) throw Object.assign(Error('TITLE_TOO_SHORT'), { statusCode: 400 });
  const bn = new URL('https://data.bn.org.pl/api/institutions/bibs.json');
  bn.searchParams.set('title', title);
  bn.searchParams.set('limit', '8');
  const ol = new URL('https://openlibrary.org/search.json');
  ol.searchParams.set('title', title);
  ol.searchParams.set('fields', 'key,title,author_name,isbn,language,first_publish_year');
  ol.searchParams.set('limit', '8');
  const bnResponse = await requestBn(bn.href);
  const candidates = [];
  const errors = [];
  if (bnResponse.status === 'found') {
    const books = bnResponse.payload?.bibs ?? bnResponse.payload?.records ?? [];
    for (const book of Array.isArray(books) ? books.slice(0, 8) : []) {
      // BN title search also returns articles and periodicals; only monographs are candidates.
      if (book.kind && !/ksi[aą][zż]ka|book/i.test(String(book.kind))) continue;
      for (const isbn of distinctEditions(isbnCandidates(book.isbnIssn ?? book.isbn ?? book.isbns ?? [])))
        candidates.push({
          isbn, source: 'bn',
          title: String(book.title ?? title).slice(0, 220),
          // BN returns authors as one free-text string ("Pratchett, Terry (1948-2015) ...").
          authors: Array.isArray(book.authors) ? book.authors.map(String).slice(0, 3) : [],
          authorText: String(book.author ?? '').slice(0, 160),
          publisher: String(book.publisher ?? '').slice(0, 80),
          language: String(book.language ?? '').slice(0, 50),
          publicationYear: String(book.publicationYear ?? '').slice(0, 10),
        });
    }
  } else if (!['not_found'].includes(bnResponse.status)) errors.push('bn');
  const olResponse = candidates.length === 0 && ['found', 'not_found'].includes(bnResponse.status)
    ? await requestOpenLibrary(ol.href)
    : { status: 'skipped' };
  if (olResponse.status === 'found') {
    for (const book of (Array.isArray(olResponse.payload?.docs) ? olResponse.payload.docs : []).slice(0, 8)) {
      for (const isbn of distinctEditions(isbnCandidates(book.isbn ?? [])))
        candidates.push({
          isbn, source: 'open_library',
          title: String(book.title ?? title).slice(0, 220),
          authors: (Array.isArray(book.author_name) ? book.author_name : []).map(String).slice(0, 3),
          language: (Array.isArray(book.language) ? book.language : []).map(String).slice(0, 3).join(', '),
          publicationYear: String(book.first_publish_year ?? '').slice(0, 10),
        });
    }
  } else if (!['not_found', 'skipped'].includes(olResponse.status)) errors.push('open_library');
  const seen = new Set();
  return {
    title,
    candidates: candidates.filter((item) => {
      if (seen.has(item.isbn)) return false;
      seen.add(item.isbn);
      return true;
    }).slice(0, 16),
    unavailable: errors,
  };
}
