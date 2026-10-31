import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionCatalog, productionCatalogEnabled } from './catalog-production.mjs';

test('production catalog activation is explicit', () => {
  assert.equal(productionCatalogEnabled({ BOOKFLIP_CATALOG_ENABLED: '1' }), true);
  assert.equal(productionCatalogEnabled({ BOOKFLIP_CATALOG_ENABLED: 'true' }), true);
  assert.equal(productionCatalogEnabled({ BOOKFLIP_CATALOG_ENABLED: '0' }), false);
  assert.equal(productionCatalogEnabled({ BOOKFLIP_CATALOG_ENABLED: '0' }), false);
  assert.equal(productionCatalogEnabled({}), true);
});

test('production dual-write stores offer, ISBN evidence and one job without network calls', () => {
  const catalog = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw new Error('NETWORK_NOT_EXPECTED');
    },
  });
  try {
    const report = catalog.ingestOffers(
      [
        {
          source: 'fixture',
          url: 'https://example.test/items/1?utm_source=test',
          title: 'Theoretical Physics',
          price: 299,
          isbn: '9780306406157',
          matchedQueries: ['physics'],
        },
      ],
      new Date('2026-01-01T00:00:00Z'),
    );
    assert.deepEqual(report, { offers: 1, evidence: 1, jobs: 1, skipped: 0 });
    assert.equal(catalog.status().counts.offers, 1);
    assert.equal(catalog.status().counts.metadata_evidence, 1);
    assert.equal(catalog.status().counts.identification_jobs, 1);
  } finally {
    catalog.close();
  }
});

test('offer without ISBN is queued for manual review and seen_count increments', async () => {
  const catalog = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw Error('NETWORK_NOT_EXPECTED');
    },
  });
  try {
    const sample = {
      source: 'fixture',
      url: 'https://example.test/items/no-isbn',
      title: 'Unknown printing',
      price: 175,
    };
    const when = new Date('2026-01-02T00:00:00Z');
    const first = catalog.ingestOffers([sample], when);
    assert.equal(first.jobs, 1);
    const second = catalog.ingestOffers([sample], new Date('2026-01-03T00:00:00Z'));
    assert.equal(second.jobs, 0);
    const row = catalog.repository.database.prepare('SELECT seen_count FROM offers LIMIT 1').get();
    assert.equal(row.seen_count, 2);
    const processed = await catalog.processQueued(1);
    assert.equal(processed.processed, 1);
    const job = catalog.repository.database
      .prepare('SELECT status FROM identification_jobs LIMIT 1')
      .get();
    assert.equal(job.status, 'review_required');
  } finally {
    catalog.close();
  }
});
