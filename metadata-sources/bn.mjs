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

export const BN_API_URL = 'https://data.bn.org.pl/api/institutions/bibs.json';

function recordsFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const records = payload.bibs ?? payload.records ?? payload.items;
  return Array.isArray(records) ? records : null;
}

function recordIdentifiers(record) {
  return record.isbnIssn ?? record.isbn ?? record.isbns ?? record.identifiers ?? [];
}

function recordAuthors(record) {
  return normalizedStringList(record.authors ?? record.author ?? record.creator ?? []);
}

function recordLanguage(record) {
  return singleValue(record.language ?? record.languages);
}

function recordId(record) {
  return normalizedText(String(record.id ?? record.recordId ?? record.mmsId ?? ''));
}

export function createBnAdapter({
  requester,
  fetcher,
  limiter,
  timeoutMs = 8_000,
  retries = 2,
  wait,
  now = () => new Date(),
} = {}) {
  const request = requester ?? createJsonRequester({ fetcher, limiter, timeoutMs, retries, wait });

  return {
    source: 'bn',
    async lookup(isbn) {
      const requestedISBN = normalizeISBN(isbn);
      if (!requestedISBN)
        return { source: 'bn', status: 'invalid_response', reason: 'invalid_isbn', records: [] };

      const url = new URL(BN_API_URL);
      url.searchParams.set('isbnIssn', requestedISBN);
      url.searchParams.set('limit', '100');
      const response = await request(url.href);
      if (response.status !== 'found') return { source: 'bn', ...response, records: [] };

      const rawRecords = recordsFromPayload(response.payload);
      if (!rawRecords) {
        return {
          source: 'bn',
          status: 'invalid_response',
          reason: 'missing_records_array',
          records: [],
        };
      }
      if (rawRecords.length === 0)
        return { source: 'bn', status: 'not_found', records: [], fetchedAt: now().toISOString() };

      const fetchedAt = now().toISOString();
      const records = [];
      const issues = [];
      for (const rawRecord of rawRecords) {
        const matched = matchingISBNs(recordIdentifiers(rawRecord), requestedISBN);
        if (matched.length === 0) {
          issues.push({ reason: 'isbn_mismatch', externalRecordId: recordId(rawRecord) });
          continue;
        }
        const externalRecordId = recordId(rawRecord);
        const title = normalizedText(rawRecord.title ?? rawRecord.name);
        if (!externalRecordId || !title) {
          issues.push({ reason: 'missing_required_fields', externalRecordId });
          continue;
        }
        const isbn10 = matched.find((value) => value.length === 10) ?? null;
        const isbn13 = matched.find((value) => value.length === 13) ?? null;
        const record = buildNormalizedRecord({
          source: 'bn',
          externalRecordId,
          workExternalId: null,
          isbn10,
          isbn13,
          title,
          authors: recordAuthors(rawRecord),
          publisher: singleValue(rawRecord.publisher ?? rawRecord.publishers),
          publicationYear: rawRecord.publicationYear ?? rawRecord.publishYear ?? rawRecord.date,
          language: recordLanguage(rawRecord),
          binding: singleValue(rawRecord.binding ?? rawRecord.physicalFormat),
          materialType: singleValue(rawRecord.materialType ?? rawRecord.kind ?? rawRecord.type),
          sourceUrl: response.url ?? url.href,
          fetchedAt,
          payloadHash: payloadHash(rawRecord),
        });
        records.push({ ...record, payload: rawRecord });
      }

      if (records.length === 0) {
        return {
          source: 'bn',
          status: 'invalid_response',
          reason: issues.some((issue) => issue.reason === 'isbn_mismatch')
            ? 'isbn_mismatch'
            : 'missing_required_fields',
          records: [],
          issues,
          fetchedAt,
        };
      }
      return {
        source: 'bn',
        status: 'found',
        records,
        ambiguous: records.length > 1,
        issues,
        fetchedAt,
      };
    },
  };
}
