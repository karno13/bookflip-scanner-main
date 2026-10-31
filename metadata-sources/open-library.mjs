import { normalizeISBN } from '../isbn-normalization.mjs';
import { createJsonRequester } from '../metadata-http.mjs';
import {
  buildNormalizedRecord,
  matchingISBNs,
  normalizedStringList,
  normalizedText,
  payloadHash,
  singleValue,
} from '../metadata-record.mjs';

export const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';

function olid(key, type) {
  const text = normalizedText(typeof key === 'object' ? key?.key : key);
  const match = text?.match(new RegExp(`^/${type}/([^/]+)$`));
  return match?.[1] ?? null;
}

function language(edition) {
  const values = (Array.isArray(edition.languages) ? edition.languages : [])
    .map((entry) => normalizedText(entry?.key ?? entry))
    .map((entry) => entry?.split('/').filter(Boolean).at(-1))
    .filter(Boolean);
  return singleValue(values);
}

function authorReferences(edition, work) {
  const references = [];
  for (const entry of [...(edition.authors ?? []), ...(work.authors ?? [])]) {
    const author = entry?.author ?? entry;
    if (author?.name) references.push({ name: author.name, key: author.key ?? null });
    else if (author?.key) references.push({ key: author.key });
  }
  const seen = new Set();
  return references.filter((entry) => {
    const identity = entry.key ?? entry.name;
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function createOpenLibraryAdapter({
  requester,
  fetcher,
  limiter,
  timeoutMs = 8_000,
  retries = 2,
  wait,
  now = () => new Date(),
  userAgent = 'BookFlip/2.0 (metadata lookup; contact not configured)',
} = {}) {
  const request = requester ?? createJsonRequester({
    fetcher,
    limiter,
    timeoutMs,
    retries,
    wait,
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
  });

  return {
    source: 'open_library',
    async lookup(isbn) {
      const requestedISBN = normalizeISBN(isbn);
      if (!requestedISBN) return { source: 'open_library', status: 'invalid_response', reason: 'invalid_isbn', records: [] };

      const editionUrl = `${OPEN_LIBRARY_BASE_URL}/isbn/${requestedISBN}.json`;
      const editionResponse = await request(editionUrl);
      if (editionResponse.status !== 'found') return { source: 'open_library', ...editionResponse, records: [] };
      const edition = editionResponse.payload;
      if (!edition || typeof edition !== 'object' || Array.isArray(edition)) {
        return { source: 'open_library', status: 'invalid_response', reason: 'missing_required_fields', records: [] };
      }

      const editionId = olid(edition.key, 'books');
      const title = normalizedText(edition.title);
      const matched = matchingISBNs([edition.isbn_10, edition.isbn_13], requestedISBN);
      const workIds = [...new Set((edition.works ?? []).map((entry) => olid(entry, 'works')).filter(Boolean))];
      if (matched.length === 0) {
        return { source: 'open_library', status: 'invalid_response', reason: 'isbn_mismatch', records: [] };
      }
      if (!editionId || !title || workIds.length !== 1) {
        return { source: 'open_library', status: 'invalid_response', reason: 'missing_required_fields', records: [] };
      }

      const workId = workIds[0];
      const workResponse = await request(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`);
      if (workResponse.status === 'temporary_error') return { source: 'open_library', ...workResponse, records: [] };
      if (workResponse.status !== 'found' || !workResponse.payload || typeof workResponse.payload !== 'object') {
        return { source: 'open_library', status: 'invalid_response', reason: 'invalid_work_record', records: [] };
      }
      const work = workResponse.payload;

      const authors = [];
      const authorPayloads = [];
      for (const reference of authorReferences(edition, work)) {
        if (reference.name) {
          authors.push(reference.name);
          continue;
        }
        const authorId = olid(reference.key, 'authors');
        if (!authorId) continue;
        const authorResponse = await request(`${OPEN_LIBRARY_BASE_URL}/authors/${authorId}.json`);
        if (authorResponse.status === 'temporary_error') return { source: 'open_library', ...authorResponse, records: [] };
        if (authorResponse.status === 'found' && authorResponse.payload && typeof authorResponse.payload === 'object') {
          authorPayloads.push(authorResponse.payload);
          if (normalizedText(authorResponse.payload.name)) authors.push(authorResponse.payload.name);
        }
      }

      const fetchedAt = now().toISOString();
      const payload = { edition, work, authors: authorPayloads };
      const isbn10 = matched.find((value) => value.length === 10) ?? null;
      const isbn13 = matched.find((value) => value.length === 13) ?? null;
      const record = buildNormalizedRecord({
        source: 'open_library',
        externalRecordId: editionId,
        workExternalId: workId,
        isbn10,
        isbn13,
        title,
        authors: normalizedStringList(authors),
        publisher: singleValue(edition.publishers),
        publicationYear: edition.publish_date,
        language: language(edition),
        binding: edition.physical_format,
        materialType: singleValue(edition.material_type ?? edition.materialType),
        sourceUrl: `${OPEN_LIBRARY_BASE_URL}/books/${editionId}`,
        fetchedAt,
        payloadHash: payloadHash(payload),
      });
      return { source: 'open_library', status: 'found', records: [{ ...record, payload }], ambiguous: false, issues: [], fetchedAt };
    },
  };
}
