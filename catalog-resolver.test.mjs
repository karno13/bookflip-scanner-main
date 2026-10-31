import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CatalogResolver } from './catalog-resolver.mjs';
import { queueHistoricalReidentification } from './historical-reidentification.mjs';
import { IdentificationWorker, claimIdentificationJob } from './identification-worker.mjs';
import { payloadHash } from './metadata-record.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const ISBN_A = '9780306406157';
const ISBN_B = '9783161484100';

function metadataRecord(source, isbn, { editionId, workId = 'OL-WORK-1', title = 'Theoretical Physics', publisher = 'Dover', year = 1986, language = 'eng', binding = 'paperback' } = {}) {
  const payload = source === 'open_library'
    ? { edition: { key: `/books/${editionId ?? 'OL-ED-1'}` }, work: { key: `/works/${workId}` }, authors: [] }
    : { id: editionId ?? 'BN-ED-1' };
  return {
    source,
    externalRecordId: editionId ?? (source === 'open_library' ? 'OL-ED-1' : 'BN-ED-1'),
    workExternalId: source === 'open_library' ? workId : null,
    isbn10: null,
    isbn13: isbn,
    title,
    authors: ['Georg Joos'],
    publisher,
    publicationYear: year,
    language,
    binding,
    materialType: 'book',
    sourceUrl: `https://example.test/${source}/${editionId}`,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    payloadHash: payloadHash(payload),
    payload,
  };
}

function lookupFor({ conflict = false, temporary = false, notFound = false, workId = 'OL-WORK-1' } = {}) {
  return async (isbn) => {
    if (temporary) return {
      bn: { source: 'bn', status: 'temporary_error', records: [] },
      openLibrary: { source: 'open_library', status: 'not_found', records: [] },
      comparison: { status: 'incomplete', conflicts: [] },
    };
    if (notFound) return {
      bn: { source: 'bn', status: 'not_found', records: [] },
      openLibrary: { source: 'open_library', status: 'not_found', records: [] },
      comparison: { status: 'not_found', conflicts: [] },
    };
    const suffix = isbn === ISBN_B ? '2' : '1';
    const bn = metadataRecord('bn', isbn, { editionId: `BN-ED-${suffix}`, workId, title: conflict ? 'Conflicting Book' : 'Theoretical Physics' });
    const ol = metadataRecord('open_library', isbn, { editionId: `OL-ED-${suffix}`, workId });
    return {
      bn: { source: 'bn', status: 'found', records: [bn] },
      openLibrary: { source: 'open_library', status: 'found', records: [ol] },
      comparison: conflict
        ? { status: 'conflict', conflicts: [{ type: 'field_conflict', field: 'title' }] }
        : { status: 'consistent', conflicts: [] },
    };
  };
}

function offer(repository, { id = `offer-${Math.random()}`, isbn = ISBN_A, title = 'Theoretical Physics', language = null } = {}) {
  return repository.upsertOffer({ id, source: 'fixture', normalizedUrl: `https://example.test/${id}`, originalTitle: title, observedIsbn: isbn, language });
}

function existingEdition(repository, isbn = ISBN_A) {
  const work = repository.createWork({ title: 'Theoretical Physics', authors: ['Georg Joos'], verificationStatus: 'verified' });
  const edition = repository.createEdition({ workId: work.id, title: 'Theoretical Physics', publisher: 'Dover', publicationYear: 1986, language: 'eng', binding: 'paperback', verificationStatus: 'verified' });
  repository.attachIdentifier(edition.id, 'isbn13', isbn, { source: 'fixture', verificationStatus: 'verified' });
  return { work, edition };
}

test('known ISBN matches an existing edition without creating a duplicate', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const { edition } = existingEdition(repository);
    const stored = offer(repository);
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ offerId: stored.id });
    assert.equal(result.decision, 'matched_existing');
    assert.equal(result.editionId, edition.id);
    assert.equal(repository.counts().editions, 1);
    assert.equal(repository.getOfferMatchHistory(stored.id).length, 1);
  } finally { repository.close(); }
});

test('unknown ISBN creates a work, edition, provenance and assignment', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ offerId: stored.id });
    assert.equal(result.decision, 'created_work_and_edition');
    assert.equal(repository.counts().works, 1);
    assert.equal(repository.counts().editions, 1);
    assert.ok(repository.counts().external_records >= 3);
    assert.ok(repository.counts().metadata_evidence > 0);
  } finally { repository.close(); }
});

test('a second ISBN with the same Open Library Work ID creates only a new edition', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const resolver = new CatalogResolver({ repository, lookupMetadata: lookupFor() });
    await resolver.resolve({ offerId: offer(repository, { id: 'first', isbn: ISBN_A }).id });
    const result = await resolver.resolve({ offerId: offer(repository, { id: 'second', isbn: ISBN_B }).id });
    assert.equal(result.decision, 'created_edition');
    assert.equal(repository.counts().works, 1);
    assert.equal(repository.counts().editions, 2);
  } finally { repository.close(); }
});

test('reprocessing the same offer is idempotent', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    const resolver = new CatalogResolver({ repository, lookupMetadata: lookupFor() });
    await resolver.resolve({ offerId: stored.id });
    const counts = repository.counts();
    const history = repository.getOfferMatchHistory(stored.id).length;
    const second = await resolver.resolve({ offerId: stored.id });
    assert.equal(second.decision, 'matched_existing');
    assert.deepEqual(repository.counts(), counts);
    assert.equal(repository.getOfferMatchHistory(stored.id).length, history);
  } finally { repository.close(); }
});

test('two concurrent resolvers converge on one edition', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-resolver-'));
  const database = join(directory, 'catalog.sqlite');
  const first = new SqliteCatalogRepository(database, { busyTimeout: 10_000 });
  const second = new SqliteCatalogRepository(database, { busyTimeout: 10_000 });
  try {
    const offerA = offer(first, { id: 'parallel-a' });
    const offerB = offer(first, { id: 'parallel-b' });
    const [left, right] = await Promise.all([
      new CatalogResolver({ repository: first, lookupMetadata: lookupFor() }).resolve({ offerId: offerA.id }),
      new CatalogResolver({ repository: second, lookupMetadata: lookupFor() }).resolve({ offerId: offerB.id }),
    ]);
    assert.equal(new Set([left.editionId, right.editionId]).size, 1);
    assert.equal(first.counts().editions, 1);
    assert.equal(first.counts().offer_matches, 2);
  } finally {
    first.close(); second.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('conflicting BN and Open Library data requires review', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor({ conflict: true }) }).resolve({ offerId: offer(repository).id });
    assert.equal(result.decision, 'review_required');
    assert.equal(repository.counts().editions, 0);
  } finally { repository.close(); }
});

test('invalid, multiple and unlabelled ISBN evidence never auto-assign', async (t) => {
  for (const scenario of [
    { name: 'invalid', offer: { isbn: '9780306406158', title: 'Theoretical Physics' } },
    { name: 'multiple', offer: { isbns: [ISBN_A, ISBN_B], title: 'Theoretical Physics' } },
    { name: 'unlabelled', offer: { description: `Copy ${ISBN_A} in good condition`, title: 'Theoretical Physics' } },
  ]) await t.test(scenario.name, async () => {
    const repository = new SqliteCatalogRepository(':memory:');
    try {
      const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ offer: scenario.offer });
      assert.equal(result.decision, 'review_required');
      assert.equal(repository.counts().offer_matches, 0);
    } finally { repository.close(); }
  });
});

test('manual assignment remains authoritative when new ISBN conflicts', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const manualEdition = existingEdition(repository, ISBN_B).edition;
    const stored = offer(repository, { isbn: ISBN_A });
    repository.assignOfferToEdition(stored.id, manualEdition.id, { method: 'manual', status: 'active', createdBy: 'user' });
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ offerId: stored.id });
    assert.equal(result.decision, 'review_required');
    assert.equal(repository.getOfferMatchHistory(stored.id).at(-1).edition_id, manualEdition.id);
    assert.equal(repository.getOfferMatchHistory(stored.id).at(-1).status, 'active');
  } finally { repository.close(); }
});

test('temporary metadata failure becomes retry_pending without losing the offer', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor({ temporary: true }) }).resolve({ offerId: stored.id });
    assert.equal(result.decision, 'retry_pending');
    assert.ok(repository.database.prepare('SELECT id FROM offers WHERE id=?').get(stored.id));
    assert.equal(repository.counts().editions, 0);
  } finally { repository.close(); }
});

test('expired worker lease is reclaimed safely after restart', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    repository.putIdentificationJob({ id: 'restart-job', offerId: stored.id, status: 'queued', at: new Date('2026-01-01T00:00:00Z') });
    const first = claimIdentificationJob(repository, { now: new Date('2026-01-01T00:00:01Z'), leaseMs: 1_000, leaseToken: 'old' });
    assert.equal(first.status, 'running');
    const reclaimed = claimIdentificationJob(repository, { now: new Date('2026-01-01T00:00:03Z'), leaseMs: 1_000, leaseToken: 'new' });
    assert.equal(reclaimed.id, first.id);
    assert.equal(reclaimed.lease_token, 'new');
    assert.equal(reclaimed.attempt_count, 2);
  } finally { repository.close(); }
});

test('legacy ISBN evidence remains review_required without new trusted evidence', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    repository.putMetadataEvidence({ offerId: stored.id, fieldName: 'isbn', value: ISBN_A, classification: 'legacy', sourceType: 'json_v2', verificationStatus: 'historical_unverified' });
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ offerId: stored.id });
    assert.equal(result.decision, 'review_required');
    assert.match(result.reason[0], /legacy/);
  } finally { repository.close(); }
});

test('processing a completed job again reuses its result and history', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    const job = repository.putIdentificationJob({ id: 'once-job', offerId: stored.id, status: 'queued' });
    const resolver = new CatalogResolver({ repository, lookupMetadata: lookupFor() });
    const worker = new IdentificationWorker({ repository, resolver });
    const first = await worker.processJobId(job.id);
    const history = repository.getOfferMatchHistory(stored.id).length;
    const second = await worker.processJobId(job.id);
    assert.equal(first.result.decision, 'created_work_and_edition');
    assert.equal(second.reused, true);
    assert.equal(repository.getOfferMatchHistory(stored.id).length, history);
  } finally { repository.close(); }
});

test('worker maps retry_pending to retry_wait and keeps a durable result', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = offer(repository);
    repository.putIdentificationJob({ id: 'retry-job', offerId: stored.id, status: 'queued' });
    const worker = new IdentificationWorker({ repository, resolver: new CatalogResolver({ repository, lookupMetadata: lookupFor({ temporary: true }) }), retryDelayMs: 1_000 });
    const processed = await worker.processNext();
    assert.equal(processed.result.decision, 'retry_pending');
    assert.equal(processed.job.status, 'retry_wait');
    assert.ok(processed.job.run_after);
  } finally { repository.close(); }
});

test('historical dry-run reports plans without modifying jobs', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const { edition } = existingEdition(repository);
    for (const id of ['history-a', 'history-b']) {
      const stored = offer(repository, { id });
      repository.assignOfferToEdition(stored.id, edition.id, { id: `match-${id}`, method: 'legacy_isbn', status: 'review_required', createdBy: 'json_v2_import' });
      repository.putIdentificationJob({ id: `job-${id}`, offerId: stored.id, status: 'review_required' });
    }
    const before = repository.database.prepare("SELECT count(*) AS count FROM identification_jobs WHERE status='queued'").get().count;
    const plan = queueHistoricalReidentification(repository, { dryRun: true, limit: 10 });
    const after = repository.database.prepare("SELECT count(*) AS count FROM identification_jobs WHERE status='queued'").get().count;
    assert.equal(plan.count, 2);
    assert.equal(plan.dryRun, true);
    assert.equal(after, before);
    assert.ok(plan.items.every((item) => item.automaticAcceptance === false));
  } finally { repository.close(); }
});

test('catalog-only dry-run plans creation and performs no writes', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupFor() }).resolve({ evidence: { status: 'valid', values: [ISBN_A], isbn: ISBN_A, candidateIsbn: ISBN_A, classification: 'structured', autoAssignable: true }, dryRun: true });
    assert.equal(result.decision, 'created_work_and_edition');
    assert.equal(result.dryRun, true);
    assert.equal(repository.counts().works, 0);
    assert.equal(repository.counts().editions, 0);
  } finally { repository.close(); }
});
