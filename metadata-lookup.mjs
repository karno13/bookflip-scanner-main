import { createHash } from 'node:crypto';

import { canonicalLookupKey, payloadHash, stableJson } from './metadata-record.mjs';

export const POSITIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const NOT_FOUND_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function deterministicId(prefix, ...values) {
  const hash = createHash('sha256').update(values.map((value) => stableJson(value)).join('|')).digest('hex');
  return `${prefix}_${hash.slice(0, 40)}`;
}

export class SqliteMetadataCache {
  constructor(repository, { now = () => new Date() } = {}) {
    if (!repository?.database) throw new TypeError('SqliteMetadataCache requires a SQLite repository');
    this.repository = repository;
    this.database = repository.database;
    this.now = now;
  }

  get(source, isbn) {
    const lookupKey = canonicalLookupKey(isbn);
    if (!lookupKey) return null;
    const row = this.database.prepare('SELECT * FROM metadata_lookup_cache WHERE source=? AND lookup_key=?').get(source, lookupKey);
    if (!row || Date.parse(row.expires_at) <= this.now().getTime()) return null;
    try {
      return { result: JSON.parse(row.response_json), fetchedAt: row.fetched_at, expiresAt: row.expires_at };
    } catch {
      return null;
    }
  }

  set(source, isbn, result) {
    if (!['found', 'not_found'].includes(result?.status)) return false;
    const lookupKey = canonicalLookupKey(isbn);
    if (!lookupKey) return false;
    const fetchedAt = this.now();
    const ttl = result.status === 'found' ? POSITIVE_CACHE_TTL_MS : NOT_FOUND_CACHE_TTL_MS;
    const responseJson = stableJson(result);
    this.database.prepare(`INSERT INTO metadata_lookup_cache(source,lookup_key,status,response_json,payload_hash,fetched_at,expires_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(source,lookup_key) DO UPDATE SET status=excluded.status,response_json=excluded.response_json,
        payload_hash=excluded.payload_hash,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`).run(
      source,
      lookupKey,
      result.status,
      responseJson,
      payloadHash(result),
      fetchedAt.toISOString(),
      new Date(fetchedAt.getTime() + ttl).toISOString(),
    );
    return true;
  }
}

function normalizedComparable(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function fieldValues(records, field) {
  const values = records.flatMap((record) => Array.isArray(record[field]) ? record[field] : [record[field]]).filter((value) => value != null && value !== '');
  return [...new Map(values.map((value) => [normalizedComparable(value), value])).values()];
}

export function compareMetadataResults(bnResult, openLibraryResult) {
  const bnRecords = bnResult.status === 'found' ? bnResult.records : [];
  const olRecords = openLibraryResult.status === 'found' ? openLibraryResult.records : [];
  const conflicts = [];
  if (bnRecords.length > 1) conflicts.push({ type: 'multiple_bn_records', count: bnRecords.length });

  if (bnRecords.length && olRecords.length) {
    for (const field of ['title', 'authors', 'publisher', 'publicationYear', 'language', 'binding', 'materialType']) {
      const bnValues = fieldValues(bnRecords, field);
      const olValues = fieldValues(olRecords, field);
      if (bnValues.length && olValues.length) {
        const left = new Set(bnValues.map(normalizedComparable));
        const overlaps = olValues.some((value) => left.has(normalizedComparable(value)));
        if (!overlaps) conflicts.push({ type: 'field_conflict', field, bn: bnValues, openLibrary: olValues });
      }
    }
  }

  let status = 'not_found';
  if (conflicts.length) status = 'conflict';
  else if (bnRecords.length && olRecords.length) status = 'consistent';
  else if (bnRecords.length || olRecords.length) status = 'single_source';
  else if ([bnResult.status, openLibraryResult.status].some((value) => ['temporary_error', 'invalid_response'].includes(value))) status = 'incomplete';
  return { status, conflicts };
}

function externalRecordInput(record, target = {}) {
  const databaseId = deterministicId('external', record.source, record.externalRecordId, record.payloadHash);
  return {
    id: databaseId,
    provider: record.source,
    externalId: record.externalRecordId,
    recordType: 'edition',
    workId: target.workId ?? null,
    editionId: target.editionId ?? null,
    status: 'found',
    payload: record.payload,
    payloadHash: record.payloadHash,
    fetchedAt: record.fetchedAt,
  };
}

const EVIDENCE_FIELDS = ['isbn10', 'isbn13', 'title', 'authors', 'publisher', 'publicationYear', 'language', 'binding', 'materialType', 'workExternalId'];

export function persistMetadataResults(repository, results, { workId = null, editionId = null } = {}) {
  return repository.transaction(() => {
    let externalRecordsCreated = 0;
    let evidenceCreated = 0;
    for (const result of results) {
      if (result.status !== 'found') continue;
      for (const record of result.records) {
        const externalInput = externalRecordInput(record, { workId, editionId });
        if (repository.putExternalRecord(externalInput).created) externalRecordsCreated += 1;

        if (record.source === 'open_library' && record.workExternalId && record.payload?.work) {
          const workHash = payloadHash(record.payload.work);
          const workInput = {
            id: deterministicId('external', record.source, record.workExternalId, workHash),
            provider: record.source,
            externalId: record.workExternalId,
            recordType: 'work',
            workId,
            status: 'found',
            payload: record.payload.work,
            payloadHash: workHash,
            fetchedAt: record.fetchedAt,
          };
          if (repository.putExternalRecord(workInput).created) externalRecordsCreated += 1;
        }

        if (!workId && !editionId) continue;
        for (const fieldName of EVIDENCE_FIELDS) {
          const value = record[fieldName];
          if (value == null || (Array.isArray(value) && value.length === 0)) continue;
          const evidenceId = deterministicId('evidence', externalInput.id, fieldName, value, workId, editionId);
          const saved = repository.putMetadataEvidence({
            id: evidenceId,
            workId,
            editionId,
            externalRecordId: externalInput.id,
            fieldName,
            value,
            classification: 'structured',
            sourceType: record.source,
            verificationStatus: 'unverified',
            observedAt: record.fetchedAt,
          });
          if (saved.created) evidenceCreated += 1;
        }
      }
    }
    return { externalRecordsCreated, evidenceCreated };
  });
}

async function lookupWithCache(adapter, isbn, cache) {
  const cached = cache?.get(adapter.source, isbn);
  if (cached) return { ...cached.result, cache: { hit: true, fetchedAt: cached.fetchedAt, expiresAt: cached.expiresAt } };
  const result = await adapter.lookup(isbn);
  const stored = cache?.set(adapter.source, isbn, result) ?? false;
  return { ...result, cache: { hit: false, stored } };
}

export async function lookupISBN(isbn, { bnAdapter, openLibraryAdapter, cache = null, repository = null, target = {} } = {}) {
  if (!canonicalLookupKey(isbn)) throw new Error('INVALID_ISBN');
  if (!bnAdapter || !openLibraryAdapter) throw new TypeError('Both metadata adapters are required');
  const [bn, openLibrary] = await Promise.all([
    lookupWithCache(bnAdapter, isbn, cache),
    lookupWithCache(openLibraryAdapter, isbn, cache),
  ]);
  const comparison = compareMetadataResults(bn, openLibrary);
  const persistence = repository ? persistMetadataResults(repository, [bn, openLibrary], target) : null;
  return { isbn: canonicalLookupKey(isbn), bn, openLibrary, comparison, persistence };
}
