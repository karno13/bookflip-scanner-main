import { cleanISBN, isbnKeys, isbnValid } from './isbn-normalization.mjs';
export { cleanISBN, isbnKeys, isbnValid, normalizeISBN } from './isbn-normalization.mjs';

const classifications = {
  structured: 5,
  labelled_description: 4,
  unlabelled_description: 3,
  ocr: 2,
  uncertain: 1,
};
const labelledPattern =
  /\b(?:ISBN(?:-1[03])?|EAN(?:-?13)?|GTIN(?:-?13)?)\s*:?\s*((?:[0-9Xx][\s\-‐‑‒–—−]*){9,12}[0-9Xx])(?![\s\-‐‑‒–—−]*\d)/gi;
const unlabelledPattern =
  /(?<![0-9A-Za-z])(?:97[89](?:[\s\-‐‑‒–—−]?\d){10}|\d(?:[\s\-‐‑‒–—−]?\d){8}[\s\-‐‑‒–—−]?[\dXx])(?![0-9A-Za-z])/g;

function canonicalISBN(value) {
  const keys = isbnKeys(value);
  return keys.find((key) => key.length === 13) || keys[0] || cleanISBN(value);
}
function descriptionField(path) {
  return /(?:^|\.)(?:description|desc|body|content|text|notes?)$/i.test(path);
}
function ocrField(path) {
  return /(?:^|\.)(?:ocr|ocrText|recognizedText)$/i.test(path);
}
function structuredField(field, label) {
  return (
    /^(?:isbn(?:[_ -]?(?:10|13|s))?|ean(?:[_ -]?13)?|gtin(?:[_ -]?13)?)$/i.test(field) ||
    /\b(?:ISBN|EAN|GTIN)(?:[-_ ]?1[03])?\b/i.test(label)
  );
}

function candidatesFromText(text, { allowUnlabelled = false } = {}) {
  const found = [],
    labelledRanges = [];
  for (const match of text.matchAll(labelledPattern)) {
    found.push({ value: match[1], labelled: true });
    labelledRanges.push([match.index, match.index + match[0].length]);
  }
  if (allowUnlabelled)
    for (const match of text.matchAll(unlabelledPattern))
      if (
        !labelledRanges.some(
          ([start, end]) => match.index < end && match.index + match[0].length > start,
        )
      )
        found.push({ value: match[0], labelled: false });
  return found;
}

// Read evidence, never infer an ISBN from a title or repair guessed digits.
export function extractOfferISBN(o = {}) {
  const observations = [];
  const add = (value, source, classification) => {
    const cleaned = cleanISBN(value);
    if (cleaned)
      observations.push({ value: cleaned, source, valid: isbnValid(cleaned), classification });
  };
  for (const field of ['isbn', 'isbn_10', 'isbn_13'])
    if (o[field]) add(o[field], field, 'structured');
  if (Array.isArray(o.isbns)) for (const value of o.isbns) add(value, 'isbns', 'structured');
  const ignored = new Set([
    'matching',
    'isbnDetection',
    'detectedISBN',
    'evaluation',
    'components',
    'history',
    'provenance',
    'manualInputSignature',
    'url',
    'imageUrl',
    'cover_image',
    'price',
    'shipping',
    'protection',
    'other',
    'id',
    'editionId',
    'workId',
    'owner',
    'external_key',
    'isbnEvidence',
    'forecast',
    'prediction',
    'purchaseForecast',
  ]);
  let remaining = 50000,
    visited = 0,
    truncated = false;
  const seen = new Set();
  const walk = (value, path, depth = 0, label = '') => {
    if (
      value == null ||
      path.split('.').some((k) => k.startsWith('_')) ||
      ignored.has(path.split('.').at(-1))
    )
      return;
    if (depth > 5 || ++visited > 1000) {
      truncated = true;
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const raw = String(value);
      if (/^https?:\/\//i.test(raw.trim())) return;
      const text = raw.slice(0, remaining).replace(/\u00a0/g, ' ');
      remaining -= text.length;
      if (text.length < raw.length) truncated = true;
      const field = path.split('.').at(-1) || '',
        isOcr = ocrField(path),
        isDescription = descriptionField(path),
        isStructured = structuredField(field, label);
      if (
        isStructured &&
        /^(?:(?:ISBN|EAN|GTIN)(?:-1[03])?\s*:?\s*)?[0-9Xx\s\-‐‑‒–—−]+$/i.test(text.trim())
      )
        add(text, path, isOcr ? 'ocr' : 'structured');
      else
        for (const candidate of candidatesFromText(text, {
          allowUnlabelled: isDescription || isOcr,
        }))
          add(
            candidate.value,
            path,
            isOcr ? 'ocr' : candidate.labelled ? 'labelled_description' : 'unlabelled_description',
          );
    } else if (typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      const context = String(value.name || value.label || value.key || '');
      for (const [key, child] of Object.entries(value)) {
        if (depth === 0 && ['isbn', 'isbn_10', 'isbn_13', 'isbns'].includes(key)) continue;
        walk(child, path ? path + '.' + key : key, depth + 1, context);
      }
    }
  };
  walk(o, '');
  const validObservations = observations.filter((row) => row.valid),
    distinct = new Map();
  for (const row of validObservations) {
    const key = canonicalISBN(row.value),
      old = distinct.get(key);
    if (!old || classifications[row.classification] > classifications[old.classification])
      distinct.set(key, row);
  }
  const values = [...distinct.keys()],
    hasInvalid = observations.some((row) => !row.valid),
    forcedUncertain = o.isbnReadUncertain === true || truncated;
  const strongest =
    [...distinct.values()].sort(
      (a, b) => classifications[b.classification] - classifications[a.classification],
    )[0]?.classification || null;
  const classification = forcedUncertain && values.length ? 'uncertain' : strongest;
  let status = 'missing';
  if (values.length > 1) status = 'conflict';
  else if (values.length === 1 && hasInvalid) status = 'uncertain';
  else if (values.length === 1 && classification === 'uncertain') status = 'uncertain';
  else if (values.length === 1 && ['unlabelled_description', 'ocr'].includes(classification))
    status = 'review';
  else if (values.length === 1) status = 'valid';
  else if (hasInvalid) status = 'invalid';
  const autoAssignable =
    status === 'valid' && ['structured', 'labelled_description'].includes(classification);
  const reviewRequired = ['conflict', 'review', 'uncertain'].includes(status);
  return {
    status,
    isbn: autoAssignable ? values[0] : null,
    candidateIsbn: values.length === 1 ? values[0] : null,
    classification,
    autoAssignable,
    reviewRequired,
    observations,
    values,
  };
}

// Optional evidence carried by an existing collector or AI reader; never grants verification.
export function bibliographicMetadata(row = {}) {
  const result = {};
  const limits = {
    isbn: 100,
    isbn_10: 100,
    isbn_13: 100,
    author: 500,
    publisher: 500,
    language: 100,
    binding: 100,
    variant: 200,
    series: 300,
    volume: 100,
    description: 10000,
    ocrText: 5000,
    isbnEvidence: 100,
  };
  for (const [field, limit] of Object.entries(limits))
    if (row[field] != null) {
      if (typeof row[field] !== 'string' || row[field].length > limit)
        throw Error('Nieprawidłowe pole bibliograficzne: ' + field);
      result[field] = row[field].trim();
    }
  for (const field of ['isbns', 'authors'])
    if (row[field] != null) {
      if (
        !Array.isArray(row[field]) ||
        row[field].length > 20 ||
        row[field].some((v) => typeof v !== 'string' || v.length > (field === 'isbns' ? 100 : 500))
      )
        throw Error('Nieprawidłowe pole bibliograficzne: ' + field);
      result[field] = row[field].map((v) => v.trim());
    }
  if (row.parameters != null) {
    if (typeof row.parameters !== 'object' || JSON.stringify(row.parameters).length > 20000)
      throw Error('Nieprawidłowe parametry oferty.');
    result.parameters = JSON.parse(JSON.stringify(row.parameters));
  }
  if (row.year != null) {
    if (!Number.isInteger(row.year) || row.year < 1400 || row.year > 2100)
      throw Error('Nieprawidłowy rok wydania.');
    result.year = row.year;
  }
  if (row.isbnReadUncertain != null) {
    if (typeof row.isbnReadUncertain !== 'boolean')
      throw Error('Nieprawidłowy status odczytu ISBN.');
    result.isbnReadUncertain = row.isbnReadUncertain;
  }
  return result;
}
