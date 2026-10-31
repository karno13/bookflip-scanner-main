import assert from 'node:assert/strict';
import test from 'node:test';
import { decideIdentificationJob, getCatalogEdition, getCatalogOffer, getCatalogWork, listCatalogOffers, listCatalogWorks, listIdentificationJobs } from './catalog-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const at = new Date('2026-10-31T10:00:00.000Z');
function fixture() {
  let id = 0;
  const repository = new SqliteCatalogRepository(':memory:', { now: () => at, idFactory: () => `id-${++id}` });
  const work = repository.createWork({ id: 'work-1', legacyId: 'book-1', title: 'Solaris', authors: ['Stanislaw Lem'], verificationStatus: 'manual' });
  const edition = repository.createEdition({ id: 'edition-1', workId: work.id, title: 'Solaris', publisher: 'WL', publicationYear: 2021, language: 'pl', verificationStatus: 'manual' });
  repository.attachIdentifier(edition.id, 'isbn13', '9780306406157', { source: 'test', verificationStatus: 'manual' });
  repository.upsertOffer({ id: 'offer-1', source: 'fixture', normalizedUrl: 'https://example.test/1', originalTitle: 'Solaris Lem', currentPrice: 2500, observedIsbn: '9780306406157', lastSeenAt: at.toISOString() });
  repository.appendPriceObservation('offer-1', 2600, new Date('2026-10-30T10:00:00Z'));
  repository.appendPriceObservation('offer-1', 2500, at);
  repository.putMetadataEvidence({ id: 'evidence-1', offerId: 'offer-1', fieldName: 'isbn', value: '9780306406157', classification: 'structured', sourceType: 'fixture', observedAt: at });
  const job = repository.putIdentificationJob({ id: 'job-1', offerId: 'offer-1', status: 'review_required', at });
  return { repository, work, edition, job };
}

test('catalog API read model exposes works, editions, offers and review evidence', () => {
  const { repository } = fixture();
  try {
    const works = listCatalogWorks(repository, { query: '978030' });
    assert.equal(works.total, 1);
    assert.equal(works.items[0].editionCount, 1);
    assert.equal(works.items[0].editions[0].identifiers[0].value, '9780306406157');
    assert.equal(getCatalogWork(repository, 'work-1').authors[0], 'Stanislaw Lem');
    assert.equal(getCatalogEdition(repository, 'edition-1').publisher, 'WL');
    assert.equal(listCatalogOffers(repository, { status: 'review' }).items[0].identification.status, 'review_required');
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.priceHistory.length, 2);
    assert.equal(detail.evidence[0].classification, 'structured');
    assert.equal(listIdentificationJobs(repository, {}).total, 1);
  } finally { repository.close(); }
});

test('manual review approval is atomic and protects the assignment', () => {
  const { repository } = fixture();
  try {
    const result = decideIdentificationJob(repository, 'job-1', { action: 'approved', editionId: 'edition-1' }, { now: () => at, idFactory: () => 'decision-1' });
    assert.equal(result.job.status, 'completed');
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.matches.at(-1).method, 'manual');
    assert.equal(detail.decisions[0].action, 'approved');
    assert.throws(() => decideIdentificationJob(repository, 'job-1', { action: 'not_book' }, { now: () => new Date('2026-10-31T11:00:00Z') }), /MANUAL_ASSIGNMENT_PROTECTED/);
  } finally { repository.close(); }
});

test('review rejection keeps the offer and records an immutable decision', () => {
  const { repository } = fixture();
  try {
    const result = decideIdentificationJob(repository, 'job-1', { action: 'proposal_rejected', editionId: 'edition-1', reason: 'Inne wydanie' }, { now: () => at, idFactory: () => 'decision-reject' });
    assert.equal(result.job.status, 'review_required');
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.matches[0].status, 'rejected');
    assert.equal(detail.decisions[0].reason, 'Inne wydanie');
    assert.throws(() => repository.database.prepare('DELETE FROM review_decisions').run(), /REVIEW_DECISIONS_IMMUTABLE/);
  } finally { repository.close(); }
});
