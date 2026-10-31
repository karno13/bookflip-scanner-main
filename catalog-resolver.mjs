import { createHash } from 'node:crypto';

import { extractOfferISBN } from './isbn.mjs';
import { isbnKeys, normalizeISBN } from './isbn-normalization.mjs';
import { compareMetadataResults, persistMetadataResults } from './metadata-lookup.mjs';

const TRUSTED = new Set(['structured', 'labelled_description']);
const REVIEW_ONLY = new Set(['unlabelled_description', 'ocr', 'uncertain', 'legacy']);

function stableId(prefix, ...values) {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
}

function text(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function arrays(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }

function canonicalEvidence(raw) {
  if (raw?.values && raw?.status) return raw;
  if (!Array.isArray(raw)) return null;
  const observations = raw.map((row) => ({
    value: String(row.value ?? row.isbn ?? ''),
    classification: row.classification ?? 'uncertain',
    valid: Boolean(normalizeISBN(row.value ?? row.isbn)),
    source: row.source ?? 'metadata_evidence',
  }));
  const values = [...new Set(observations.filter((row) => row.valid).map((row) => isbnKeys(row.value).find((key) => key.length === 13) ?? normalizeISBN(row.value)))];
  const classifications = observations.filter((row) => row.valid).map((row) => row.classification);
  const classification = classifications.includes('structured') ? 'structured'
    : classifications.includes('labelled_description') ? 'labelled_description'
      : classifications[0] ?? null;
  const invalid = observations.some((row) => !row.valid);
  const status = values.length > 1 ? 'conflict' : values.length === 0 ? (invalid ? 'invalid' : 'missing')
    : invalid ? 'uncertain' : REVIEW_ONLY.has(classification) ? 'review' : 'valid';
  return { status, values, candidateIsbn: values.length === 1 ? values[0] : null, isbn: status === 'valid' ? values[0] : null, classification, observations, autoAssignable: status === 'valid' && TRUSTED.has(classification), reviewRequired: ['conflict', 'review', 'uncertain'].includes(status) };
}

function contextForOffer(offer = {}) {
  return {
    title: offer.original_title ?? offer.originalTitle ?? offer.title ?? null,
    authors: offer.authors ?? (offer.author ? [offer.author] : []),
    publisher: offer.publisher ?? null,
    publicationYear: offer.publication_year ?? offer.publicationYear ?? offer.year ?? null,
    language: offer.language ?? null,
    binding: offer.binding ?? offer.variant ?? null,
  };
}

export function compareOfferContext(offer, record) {
  const context = contextForOffer(offer);
  const matches = [];
  const conflicts = [];
  const offerTitle = text(context.title);
  const recordTitle = text(record.title);
  if (offerTitle && recordTitle) {
    if (offerTitle.includes(recordTitle) || recordTitle.includes(offerTitle)) matches.push('title');
    else conflicts.push({ field: 'title', offer: context.title, catalog: record.title });
  }
  const offerAuthors = arrays(context.authors).map(text).filter(Boolean);
  const recordAuthors = arrays(record.authors).map(text).filter(Boolean);
  if (offerAuthors.length && recordAuthors.length) {
    if (offerAuthors.some((left) => recordAuthors.some((right) => left === right || left.includes(right) || right.includes(left)))) matches.push('authors');
    else conflicts.push({ field: 'authors', offer: context.authors, catalog: record.authors });
  } else if (offerTitle && recordAuthors.some((author) => author.split(' ').some((part) => part.length >= 4 && offerTitle.includes(part)))) {
    matches.push('authors_in_title');
  }
  for (const field of ['publisher', 'language', 'binding']) {
    if (context[field] != null && record[field] != null) {
      if (text(context[field]) === text(record[field])) matches.push(field);
      else conflicts.push({ field, offer: context[field], catalog: record[field] });
    }
  }
  if (context.publicationYear != null && record.publicationYear != null) {
    if (Number(context.publicationYear) === Number(record.publicationYear)) matches.push('publicationYear');
    else conflicts.push({ field: 'publicationYear', offer: context.publicationYear, catalog: record.publicationYear });
  }
  const sufficient = matches.includes('title') || matches.filter((field) => field !== 'authors_in_title').length >= 2;
  return { matches, conflicts, sufficient, context };
}

function localRecord(repository, edition) {
  const work = repository.database.prepare('SELECT * FROM works WHERE id=?').get(edition.work_id);
  return {
    title: edition.title || work?.title,
    authors: JSON.parse(work?.authors_json || '[]'),
    publisher: edition.publisher,
    publicationYear: edition.publication_year,
    language: edition.language,
    binding: edition.binding,
  };
}

function activeMatch(repository, offerId) {
  if (!offerId) return null;
  return repository.database.prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active' ORDER BY valid_from DESC LIMIT 1").get(offerId) ?? null;
}

function externalEdition(repository, records) {
  for (const record of records) {
    const row = repository.database.prepare(`SELECT COALESCE(r.edition_id,l.edition_id) AS edition_id
      FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id
      WHERE r.provider=? AND r.external_id=? AND COALESCE(r.edition_id,l.edition_id) IS NOT NULL
      ORDER BY r.fetched_at DESC LIMIT 1`).get(record.source, record.externalRecordId);
    if (row?.edition_id) return repository.database.prepare('SELECT * FROM editions WHERE id=?').get(row.edition_id);
    const scheme = record.source === 'open_library' ? 'open_library' : record.source === 'bn' ? 'bn' : null;
    const identified = scheme ? repository.database.prepare('SELECT e.* FROM edition_identifiers i JOIN editions e ON e.id=i.edition_id WHERE i.scheme=? AND i.normalized_value=?').get(scheme, record.externalRecordId) : null;
    if (identified) return identified;
  }
  return null;
}

function externalWork(repository, record) {
  if (!record?.workExternalId) return null;
  return repository.database.prepare(`SELECT w.* FROM external_records r
    LEFT JOIN external_record_links l ON l.external_record_id=r.id
    JOIN works w ON w.id=COALESCE(r.work_id,l.work_id)
    WHERE r.provider=? AND r.external_id=? ORDER BY r.fetched_at DESC LIMIT 1`).get(record.source, record.workExternalId) ?? null;
}

function mergeRecords(result) {
  const all = [result.openLibrary, result.bn].filter((entry) => entry.status === 'found').flatMap((entry) => entry.records);
  const primary = all.find((record) => record.source === 'open_library') ?? all[0];
  if (!primary) return null;
  const merged = { ...primary };
  for (const record of all) for (const field of ['isbn10', 'isbn13', 'title', 'publisher', 'publicationYear', 'language', 'binding', 'materialType']) if (merged[field] == null) merged[field] = record[field];
  if (!merged.authors?.length) merged.authors = all.find((record) => record.authors?.length)?.authors ?? [];
  return { record: merged, records: all };
}

function decision(type, reason, evidence, ids = {}, extra = {}) {
  return { decision: type, reason, evidence, workId: ids.workId ?? null, editionId: ids.editionId ?? null, offerMatchId: ids.offerMatchId ?? null, ...extra };
}

export class CatalogResolver {
  constructor({ repository, lookupMetadata, now = () => new Date() } = {}) {
    if (!repository || typeof lookupMetadata !== 'function') throw new TypeError('repository and lookupMetadata are required');
    this.repository = repository;
    this.lookupMetadata = lookupMetadata;
    this.now = now;
  }

  evidenceForOffer(offer) {
    const rows = offer?.id ? this.repository.database.prepare("SELECT value_json,classification,source_type FROM metadata_evidence WHERE offer_id=? AND field_name='isbn' ORDER BY observed_at").all(offer.id) : [];
    if (rows.length) return canonicalEvidence(rows.map((row) => ({ value: JSON.parse(row.value_json), classification: row.classification, source: row.source_type })));
    const candidate = { ...offer, isbn: offer?.isbn ?? offer?.observed_isbn };
    return extractOfferISBN(candidate);
  }

  async resolve({ offerId = null, offer = null, evidence = null, dryRun = false } = {}) {
    const storedOffer = offerId ? this.repository.database.prepare('SELECT * FROM offers WHERE id=?').get(offerId) : null;
    const currentOffer = { ...(storedOffer ?? {}), ...(offer ?? {}) };
    const isbnEvidence = canonicalEvidence(evidence) ?? this.evidenceForOffer(currentOffer);
    const proof = { isbn: isbnEvidence, metadataRecords: [] };
    const manual = activeMatch(this.repository, offerId);
    const manualProtected = manual && ['manual', 'legacy_manual'].includes(manual.method);

    if (isbnEvidence.status === 'missing') return manualProtected
      ? decision('matched_existing', ['manual_assignment_preserved'], proof, { editionId: manual.edition_id, offerMatchId: manual.id })
      : decision('review_required', ['no_isbn_evidence'], proof);
    if (isbnEvidence.status === 'invalid') return decision('review_required', ['invalid_isbn'], proof, manualProtected ? { editionId: manual.edition_id, offerMatchId: manual.id } : {});
    if (isbnEvidence.status === 'conflict') return decision('review_required', ['multiple_conflicting_isbn'], proof, manualProtected ? { editionId: manual.edition_id, offerMatchId: manual.id } : {});
    if (!isbnEvidence.autoAssignable || REVIEW_ONLY.has(isbnEvidence.classification)) return decision('review_required', [`isbn_evidence_${isbnEvidence.classification ?? isbnEvidence.status}_requires_review`], proof, manualProtected ? { editionId: manual.edition_id, offerMatchId: manual.id } : {});

    const isbn = normalizeISBN(isbnEvidence.isbn ?? isbnEvidence.candidateIsbn);
    const existing = this.repository.findEditionByISBN(isbn);
    if (manualProtected && existing && manual.edition_id !== existing.id) return decision('review_required', ['manual_assignment_conflicts_with_isbn'], proof, { editionId: manual.edition_id, offerMatchId: manual.id });
    if (manualProtected && !existing) return decision('review_required', ['manual_assignment_preserved_unverified_candidate'], proof, { editionId: manual.edition_id, offerMatchId: manual.id });
    if (existing) return this.#matchExisting(existing, currentOffer, offerId, isbnEvidence, proof, dryRun);

    const metadata = await this.lookupMetadata(isbn);
    proof.metadataRecords = [metadata.bn, metadata.openLibrary].flatMap((entry) => entry?.records ?? []).map((record) => ({ source: record.source, externalRecordId: record.externalRecordId, workExternalId: record.workExternalId, payloadHash: record.payloadHash }));
    const comparison = metadata.comparison ?? compareMetadataResults(metadata.bn, metadata.openLibrary);
    if ([metadata.bn?.status, metadata.openLibrary?.status].includes('temporary_error')) return decision('retry_pending', ['metadata_source_temporary_error'], proof);
    if (comparison.status === 'conflict') return decision('review_required', ['metadata_sources_conflict'], proof, {}, { conflicts: comparison.conflicts });
    if (comparison.status === 'incomplete') return decision('review_required', ['metadata_invalid_or_incomplete'], proof);
    if (comparison.status === 'not_found') return decision('not_found', ['isbn_not_found_in_metadata_sources'], proof);

    const selected = mergeRecords(metadata);
    if (!selected) return decision('not_found', ['no_matching_metadata_record'], proof);
    const context = offerId || offer ? compareOfferContext(currentOffer, selected.record) : { matches: ['catalog_only'], conflicts: [], sufficient: true };
    if (context.conflicts.length || !context.sufficient) return decision('review_required', context.conflicts.length ? ['offer_metadata_conflict'] : ['insufficient_offer_context'], proof, {}, { context });

    const linkedEdition = externalEdition(this.repository, selected.records);
    if (linkedEdition) return this.#matchExisting(linkedEdition, currentOffer, offerId, isbnEvidence, proof, dryRun, context);
    return this.#createCatalog({ isbn, metadata, selected, currentOffer, offerId, isbnEvidence, proof, dryRun, context });
  }

  #matchExisting(edition, offer, offerId, isbnEvidence, proof, dryRun, precomputed = null) {
    const context = precomputed ?? compareOfferContext(offer, localRecord(this.repository, edition));
    if (context.conflicts.length || !context.sufficient) return decision('review_required', context.conflicts.length ? ['offer_catalog_conflict'] : ['insufficient_offer_context'], proof, { workId: edition.work_id, editionId: edition.id }, { context });
    const current = activeMatch(this.repository, offerId);
    if (current && ['manual', 'legacy_manual'].includes(current.method) && current.edition_id !== edition.id) return decision('review_required', ['manual_assignment_conflicts_with_candidate'], proof, { workId: edition.work_id, editionId: current.edition_id, offerMatchId: current.id });
    if (current?.edition_id === edition.id) return decision('matched_existing', ['existing_active_assignment'], proof, { workId: edition.work_id, editionId: edition.id, offerMatchId: current.id }, { context, dryRun });
    const matchId = offerId ? stableId('resolver_match', offerId, edition.id) : null;
    if (!dryRun && offerId) this.repository.transaction(() => {
      const afterLock = activeMatch(this.repository, offerId);
      if (afterLock && ['manual', 'legacy_manual'].includes(afterLock.method) && afterLock.edition_id !== edition.id) throw new Error('MANUAL_ASSIGNMENT_CONFLICT');
      if (!afterLock || afterLock.edition_id !== edition.id) this.repository.assignOfferToEdition(offerId, edition.id, { id: matchId, method: isbnEvidence.classification === 'structured' ? 'structured_isbn' : 'metadata', status: 'active', reason: JSON.stringify({ rule: 'isbn_and_context_match', evidence: proof }), createdBy: 'catalog_resolver', at: this.now() });
    });
    return decision('matched_existing', ['isbn_exists_and_context_matches'], proof, { workId: edition.work_id, editionId: edition.id, offerMatchId: matchId }, { context, dryRun });
  }

  #createCatalog({ isbn, metadata, selected, currentOffer, offerId, isbnEvidence, proof, dryRun, context }) {
    const existingWork = externalWork(this.repository, selected.records.find((record) => record.workExternalId));
    const workId = existingWork?.id ?? stableId('resolver_work', selected.record.workExternalId ?? isbn);
    const editionId = stableId('resolver_edition', isbnKeys(isbn).find((key) => key.length === 13) ?? isbn);
    const type = existingWork ? 'created_edition' : 'created_work_and_edition';
    if (dryRun) return decision(type, [existingWork ? 'external_work_exists' : 'no_external_work_match', 'metadata_and_offer_context_match'], proof, { workId, editionId, offerMatchId: offerId ? stableId('resolver_match', offerId, editionId) : null }, { context, dryRun: true });

    return this.repository.transaction(() => {
      const concurrent = this.repository.findEditionByISBN(isbn);
      if (concurrent) return this.#matchExisting(concurrent, currentOffer, offerId, isbnEvidence, proof, false);
      const work = existingWork ?? this.repository.createWork({ id: workId, title: selected.record.title, normalizedTitle: text(selected.record.title), authors: selected.record.authors, verificationStatus: 'verified', at: this.now() });
      const edition = this.repository.createEdition({ id: editionId, workId: work.id, title: selected.record.title, publisher: selected.record.publisher, publicationYear: selected.record.publicationYear, language: selected.record.language, binding: selected.record.binding, verificationStatus: 'verified', at: this.now() });
      for (const key of isbnKeys(isbn)) this.repository.attachIdentifier(edition.id, key.length === 10 ? 'isbn10' : 'isbn13', key, { source: 'catalog_resolver', verificationStatus: 'verified', at: this.now() });
      for (const record of selected.records) {
        const scheme = record.source === 'open_library' ? 'open_library' : record.source === 'bn' ? 'bn' : null;
        if (scheme) this.repository.attachIdentifier(edition.id, scheme, record.externalRecordId, { source: record.source, verificationStatus: 'verified', at: this.now() });
      }
      persistMetadataResults(this.repository, [metadata.bn, metadata.openLibrary], { workId: work.id, editionId: edition.id });
      const externalRows = this.repository.database.prepare(`SELECT id,record_type FROM external_records WHERE (provider,external_id) IN (${selected.records.map(() => '(?,?)').join(',')})`).all(...selected.records.flatMap((record) => [record.source, record.externalRecordId]));
      for (const row of externalRows) this.repository.database.prepare('INSERT OR IGNORE INTO external_record_links(external_record_id,work_id,edition_id,linked_at) VALUES(?,?,?,?)').run(row.id, work.id, edition.id, this.now().toISOString());
      const workRecord = selected.records.find((record) => record.workExternalId);
      if (workRecord) {
        const row = this.repository.database.prepare("SELECT id FROM external_records WHERE provider=? AND external_id=? AND record_type='work' ORDER BY fetched_at DESC LIMIT 1").get(workRecord.source, workRecord.workExternalId);
        if (row) this.repository.database.prepare('INSERT OR IGNORE INTO external_record_links(external_record_id,work_id,edition_id,linked_at) VALUES(?,?,NULL,?)').run(row.id, work.id, this.now().toISOString());
      }
      const matchId = offerId ? stableId('resolver_match', offerId, edition.id) : null;
      if (offerId) this.repository.assignOfferToEdition(offerId, edition.id, { id: matchId, method: isbnEvidence.classification === 'structured' ? 'structured_isbn' : 'metadata', status: 'active', reason: JSON.stringify({ rule: 'verified_metadata_and_context', evidence: proof }), createdBy: 'catalog_resolver', at: this.now() });
      return decision(type, [existingWork ? 'external_work_exists' : 'new_external_work', 'metadata_and_offer_context_match'], proof, { workId: work.id, editionId: edition.id, offerMatchId: matchId }, { context, dryRun: false });
    });
  }
}
