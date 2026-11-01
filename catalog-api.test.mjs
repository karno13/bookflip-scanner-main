import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideIdentificationJob,
  getCatalogEdition,
  getCatalogOffer,
  getCatalogWork,
  listCatalogOffers,
  listCatalogWorks,
  listIdentificationJobs,
} from './catalog-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const at = new Date('2026-10-31T10:00:00.000Z');
function fixture() {
  let id = 0;
  const repository = new SqliteCatalogRepository(':memory:', {
    now: () => at,
    idFactory: () => `id-${++id}`,
  });
  const work = repository.createWork({
    id: 'work-1',
    legacyId: 'book-1',
    title: 'Solaris',
    authors: ['Stanislaw Lem'],
    verificationStatus: 'manual',
  });
  const edition = repository.createEdition({
    id: 'edition-1',
    workId: work.id,
    title: 'Solaris',
    publisher: 'WL',
    publicationYear: 2021,
    language: 'pl',
    verificationStatus: 'manual',
  });
  repository.attachIdentifier(edition.id, 'isbn13', '9780306406157', {
    source: 'test',
    verificationStatus: 'manual',
  });
  repository.upsertOffer({
    id: 'offer-1',
    source: 'fixture',
    normalizedUrl: 'https://example.test/1',
    originalTitle: 'Solaris Lem',
    currentPrice: 2500,
    observedIsbn: '9780306406157',
    lastSeenAt: at.toISOString(),
  });
  repository.appendPriceObservation('offer-1', 2600, new Date('2026-10-30T10:00:00Z'));
  repository.appendPriceObservation('offer-1', 2500, at);
  repository.putMetadataEvidence({
    id: 'evidence-1',
    offerId: 'offer-1',
    fieldName: 'isbn',
    value: '9780306406157',
    classification: 'structured',
    sourceType: 'fixture',
    observedAt: at,
  });
  const job = repository.putIdentificationJob({
    id: 'job-1',
    offerId: 'offer-1',
    status: 'review_required',
    at,
  });
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
    assert.equal(
      listCatalogOffers(repository, { status: 'review' }).items[0].identification.status,
      'review_required',
    );
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.priceHistory.length, 2);
    assert.equal(detail.evidence[0].classification, 'structured');
    assert.equal(listIdentificationJobs(repository, {}).total, 1);
  } finally {
    repository.close();
  }
});

test('manual review approval is atomic and protects the assignment', () => {
  const { repository } = fixture();
  try {
    const result = decideIdentificationJob(
      repository,
      'job-1',
      { action: 'approved', editionId: 'edition-1' },
      { now: () => at, idFactory: () => 'decision-1' },
    );
    assert.equal(result.job.status, 'completed');
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.matches.at(-1).method, 'manual');
    assert.equal(detail.decisions[0].action, 'approved');
    assert.throws(
      () =>
        decideIdentificationJob(
          repository,
          'job-1',
          { action: 'not_book' },
          { now: () => new Date('2026-10-31T11:00:00Z') },
        ),
      /MANUAL_ASSIGNMENT_PROTECTED/,
    );
  } finally {
    repository.close();
  }
});

test('review rejection keeps the offer and records an immutable decision', () => {
  const { repository } = fixture();
  try {
    const result = decideIdentificationJob(
      repository,
      'job-1',
      { action: 'proposal_rejected', editionId: 'edition-1', reason: 'Inne wydanie' },
      { now: () => at, idFactory: () => 'decision-reject' },
    );
    assert.equal(result.job.status, 'review_required');
    const detail = getCatalogOffer(repository, 'offer-1');
    assert.equal(detail.matches[0].status, 'rejected');
    assert.equal(detail.decisions[0].reason, 'Inne wydanie');
    assert.throws(
      () => repository.database.prepare('DELETE FROM review_decisions').run(),
      /REVIEW_DECISIONS_IMMUTABLE/,
    );
  } finally {
    repository.close();
  }
});

test('catalog LIKE search treats % and _ as text, not wildcards', () => {
  const { repository } = fixture();
  try {
    assert.equal(listCatalogWorks(repository, { query: '%' }).total, 0);
    assert.equal(listCatalogWorks(repository, { query: '_' }).total, 0);
    assert.equal(listCatalogOffers(repository, { query: '%' }).total, 0);
    assert.equal(listCatalogOffers(repository, { query: '_' }).total, 0);
    assert.equal(listCatalogWorks(repository, { query: 'sol' }).total, 1);
    assert.equal(listCatalogOffers(repository, { query: 'solar' }).total, 1);
    repository.createWork({
      id: 'special',
      title: '100% Warszawa_42',
      verificationStatus: 'manual',
    });
    assert.equal(listCatalogWorks(repository, { query: '%' }).total, 1);
    assert.equal(listCatalogWorks(repository, { query: '_42' }).total, 1);
  } finally {
    repository.close();
  }
});

test('SQLite global offer and review search matches source outside first page', () => {
  const { repository } = fixture();
  try {
    for (let i = 0; i < 260; i++)
      repository.upsertOffer({
        id: 'bulk-' + i,
        source: 'fixture',
        normalizedUrl: 'https://example.test/bulk/' + i,
        originalTitle: 'Other title ' + i,
        currentPrice: 100 + i,
        lastSeenAt: at.toISOString(),
      });
    repository.upsertOffer({
      id: 'search-target',
      source: 'RareSource',
      normalizedUrl: 'https://example.test/search-target',
      originalTitle: 'Special edition',
      currentPrice: 900,
      lastSeenAt: at.toISOString(),
    });
    repository.putIdentificationJob({ offerId: 'search-target', status: 'review_required', at });
    const offers = listCatalogOffers(repository, { query: 'raresource', limit: 25, offset: 0 });
    assert.equal(offers.total, 1);
    assert.equal(offers.items[0].id, 'search-target');
    const jobs = listIdentificationJobs(repository, { query: 'raresource' });
    assert.equal(jobs.total, 1);
    assert.equal(jobs.items[0].offerId, 'search-target');
    assert.equal(listCatalogOffers(repository, { query: '%' }).total, 0);
  } finally {
    repository.close();
  }
});

test('offer sorts and review filters work across the entire SQLite catalogue', () => {
  const { repository } = fixture();
  try {
    repository.upsertOffer({
      id: 'cheap',
      source: 'OtherSource',
      normalizedUrl: 'https://example.test/cheap',
      originalTitle: 'Cheap edition',
      currentPrice: 99,
      lastSeenAt: at.toISOString(),
    });
    repository.upsertOffer({
      id: 'expensive',
      source: 'AnotherSource',
      normalizedUrl: 'https://example.test/expensive',
      originalTitle: 'Expensive edition',
      currentPrice: 9000,
      lastSeenAt: at.toISOString(),
    });
    repository.putIdentificationJob({ offerId: 'cheap', status: 'review_required', at });
    const asc = listCatalogOffers(repository, { sort: 'price-asc' }).items;
    assert.equal(asc[0].id, 'cheap');
    assert.equal(listCatalogOffers(repository, { sort: 'price-desc' }).items[0].id, 'expensive');
    assert.equal(listCatalogOffers(repository, { source: 'OtherSource' }).total, 1);
    assert.equal(
      listIdentificationJobs(repository, { isbn: 'missing' }).items.some(
        (j) => j.offerId === 'cheap',
      ),
      true,
    );
    assert.equal(
      listIdentificationJobs(repository, { isbn: 'present' }).items.some(
        (j) => j.offerId === 'cheap',
      ),
      false,
    );
    assert.equal(
      listIdentificationJobs(repository, { source: 'OtherSource', isbn: 'missing' }).total,
      1,
    );
    assert.equal(
      listIdentificationJobs(repository, { query: '_', source: 'OtherSource' }).total,
      0,
    );
    assert.equal(listIdentificationJobs(repository, { sort: 'price' }).items[0].offerId, 'cheap');
  } finally {
    repository.close();
  }
});

test('offer pagination preserves unique offer identities and stable totals', () => {
  const { repository } = fixture();
  try {
    for (let i = 0; i < 6; i++) {
      repository.upsertOffer({
        id: 'page-' + i,
        source: 'fixture',
        normalizedUrl: 'https://example.test/page/' + i,
        originalTitle: 'Page ' + i,
        currentPrice: 100 + i,
        lastSeenAt: at.toISOString(),
      });
      repository.putIdentificationJob({
        id: 'page-job-' + i,
        offerId: 'page-' + i,
        status: 'review_required',
        at,
      });
    }
    const first = listCatalogOffers(repository, { limit: 3, offset: 0 });
    const second = listCatalogOffers(repository, { limit: 3, offset: 3 });
    const third = listCatalogOffers(repository, { limit: 3, offset: 6 });
    const ids = [...first.items, ...second.items, ...third.items].map((row) => row.id);
    assert.equal(first.total, 7);
    assert.equal(second.total, 7);
    assert.equal(third.total, 7);
    assert.equal(ids.length, 7);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    repository.close();
  }
});
