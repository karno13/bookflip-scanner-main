import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogResolver } from './catalog-resolver.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { payloadHash } from './metadata-record.mjs';

const isbn = '9780306406157';
function record(source, title, year) {
  const payload = { id: source + '-1' };
  return {
    source, externalRecordId: source + '-1', workExternalId: null,
    isbn13: isbn, isbn10: null, title, authors: ['Author'],
    publisher: null, publicationYear: year, language: null, binding: null,
    materialType: 'book', sourceUrl: 'https://example.test',
    fetchedAt: '2026-11-01T00:00:00Z', payload,
    payloadHash: payloadHash(payload),
  };
}
test('trusted BN ISBN creates edition despite translation and year disagreement', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const bn = record('bn', 'Era Mroku: antologia opowiadań', 2019);
    const ol = record('open_library', 'Era Mroku', 2011);
    const offer = repo.upsertOffer({
      source: 'test', normalizedUrl: 'https://example.test/offer',
      originalTitle: 'Era Mroku Herezja Horusa', observedIsbn: isbn,
    });
    const result = await new CatalogResolver({
      repository: repo,
      lookupMetadata: async () => ({
        bn: { status: 'found', records: [bn] },
        openLibrary: { status: 'found', records: [ol] },
        comparison: { status: 'conflict', conflicts: [
          { type: 'field_conflict', field: 'title' },
          { type: 'field_conflict', field: 'publicationYear' },
        ] },
      }),
    }).resolve({ offerId: offer.id });
    assert.equal(result.decision, 'created_work_and_edition');
    assert.equal(repo.findEditionByISBN(isbn)?.publication_year, 2019);
  } finally { repo.close(); }
});
test('mismatching marketplace title still does not auto-create an edition', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const bn = record('bn', 'Completely Different Title', 2019);
    const offer = repo.upsertOffer({
      source: 'test', normalizedUrl: 'https://example.test/other',
      originalTitle: 'Era Mroku', observedIsbn: isbn,
    });
    const result = await new CatalogResolver({
      repository: repo,
      lookupMetadata: async () => ({
        bn: { status: 'found', records: [bn] },
        openLibrary: { status: 'not_found', records: [] },
        comparison: { status: 'single_source', conflicts: [] },
      }),
    }).resolve({ offerId: offer.id });
    assert.equal(result.decision, 'review_required');
  } finally { repo.close(); }
});
