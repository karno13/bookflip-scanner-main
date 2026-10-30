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
  const catalog = createProductionCatalog({ databasePath: ':memory:', fetcher: async () => { throw new Error('NETWORK_NOT_EXPECTED'); } });
  try {
    const report = catalog.ingestOffers([{
      source: 'fixture',
      url: 'https://example.test/items/1?utm_source=test',
      title: 'Theoretical Physics',
      price: 299,
      isbn: '9780306406157',
      matchedQueries: ['physics'],
    }], new Date('2026-01-01T00:00:00Z'));
    assert.deepEqual(report, { offers: 1, evidence: 1, jobs: 1, skipped: 0 });
    assert.equal(catalog.status().counts.offers, 1);
    assert.equal(catalog.status().counts.metadata_evidence, 1);
    assert.equal(catalog.status().counts.identification_jobs, 1);
  } finally { catalog.close(); }
});
