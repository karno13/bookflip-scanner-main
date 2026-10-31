import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogResolver } from './catalog-resolver.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const ISBN = '9780306406157';

test('metadata not_found creates neither a work nor an edition', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const lookupMetadata = async () => ({
      bn: { source: 'bn', status: 'not_found', records: [] },
      openLibrary: { source: 'open_library', status: 'not_found', records: [] },
      comparison: { status: 'not_found', conflicts: [] },
    });
    const evidence = {
      status: 'valid',
      values: [ISBN],
      isbn: ISBN,
      candidateIsbn: ISBN,
      classification: 'structured',
      autoAssignable: true,
    };
    const result = await new CatalogResolver({ repository, lookupMetadata }).resolve({ evidence });
    assert.equal(result.decision, 'not_found');
    assert.equal(repository.counts().works, 0);
    assert.equal(repository.counts().editions, 0);
  } finally {
    repository.close();
  }
});

test('labelled description still requires contextual metadata agreement', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const lookupMetadata = async () => {
      const record = {
        source: 'bn',
        externalRecordId: 'BN-1',
        workExternalId: null,
        isbn13: ISBN,
        isbn10: null,
        title: 'Expected Book',
        authors: [],
        publisher: null,
        publicationYear: null,
        language: null,
        binding: null,
        materialType: 'book',
        sourceUrl: 'https://example.test',
        fetchedAt: '2026-01-01T00:00:00Z',
        payloadHash: 'hash',
        payload: { id: 1 },
      };
      return {
        bn: { source: 'bn', status: 'found', records: [record] },
        openLibrary: { source: 'open_library', status: 'not_found', records: [] },
        comparison: { status: 'single_source', conflicts: [] },
      };
    };
    const result = await new CatalogResolver({ repository, lookupMetadata }).resolve({
      offer: { description: `ISBN: ${ISBN}`, title: 'A Different Book' },
    });
    assert.equal(result.decision, 'review_required');
    assert.deepEqual(result.reason, ['offer_metadata_conflict']);
  } finally {
    repository.close();
  }
});
