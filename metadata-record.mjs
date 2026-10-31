import { createHash } from 'node:crypto';

import { isbnKeys, normalizeISBN } from './isbn-normalization.mjs';

export const METADATA_SOURCES = Object.freeze({ BN: 'bn', OPEN_LIBRARY: 'open_library' });

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function payloadHash(payload) {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export function normalizedText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

export function normalizedStringList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(normalizedText).filter(Boolean))];
}

export function singleValue(value) {
  const values = normalizedStringList(value);
  return values.length === 1 ? values[0] : null;
}

export function publicationYear(value) {
  if (Number.isInteger(value) && value >= 1000 && value <= 2999) return value;
  const text = normalizedText(String(value ?? ''));
  const match = text?.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  const year = match ? Number(match[1]) : null;
  return year && year >= 1000 && year <= 2999 ? year : null;
}

export function isbnCandidates(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const candidates = [];
  for (const entry of values) {
    if (entry && typeof entry === 'object') {
      candidates.push(...isbnCandidates(Object.values(entry)));
      continue;
    }
    const matches =
      String(entry ?? '').match(/(?<!\d)(?:97[89][\d\s-]{10,20}\d|\d[\d\s-]{7,16}[\dXx])(?!\d)/g) ??
      [];
    for (const match of matches) {
      const normalized = normalizeISBN(match);
      if (normalized) candidates.push(normalized);
    }
  }
  return [...new Set(candidates)];
}

export function isEquivalentISBN(candidate, requested) {
  const candidateKeys = new Set(isbnKeys(candidate));
  return isbnKeys(requested).some((key) => candidateKeys.has(key));
}

export function matchingISBNs(values, requested) {
  return isbnCandidates(values).filter((value) => isEquivalentISBN(value, requested));
}

export function buildNormalizedRecord(values) {
  return {
    source: values.source,
    externalRecordId: normalizedText(String(values.externalRecordId ?? '')),
    workExternalId: normalizedText(String(values.workExternalId ?? '')),
    isbn10: normalizeISBN(values.isbn10)?.length === 10 ? normalizeISBN(values.isbn10) : null,
    isbn13: normalizeISBN(values.isbn13)?.length === 13 ? normalizeISBN(values.isbn13) : null,
    title: normalizedText(values.title),
    authors: normalizedStringList(values.authors),
    publisher: normalizedText(values.publisher),
    publicationYear: publicationYear(values.publicationYear),
    language: normalizedText(values.language),
    binding: normalizedText(values.binding),
    materialType: normalizedText(values.materialType),
    sourceUrl: normalizedText(values.sourceUrl),
    fetchedAt: normalizedText(values.fetchedAt),
    payloadHash: values.payloadHash,
  };
}

export function canonicalLookupKey(isbn) {
  const keys = isbnKeys(isbn);
  return keys.find((key) => key.length === 13) ?? keys[0] ?? null;
}
