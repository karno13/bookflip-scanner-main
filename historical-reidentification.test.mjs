import assert from 'node:assert/strict';
import test from 'node:test';

import { queueHistoricalReidentification } from './historical-reidentification.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('historical reidentification queues individual records only when dry-run is disabled', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const work = repository.createWork({
      title: 'Legacy Work',
      verificationStatus: 'historical_unverified',
    });
    const edition = repository.createEdition({
      workId: work.id,
      title: 'Legacy Edition',
      verificationStatus: 'historical_unverified',
    });
    const offer = repository.upsertOffer({
      id: 'legacy-offer',
      source: 'legacy',
      normalizedUrl: 'https://example.test/legacy',
      originalTitle: 'Legacy Edition',
      observedIsbn: '9780306406157',
    });
    repository.assignOfferToEdition(offer.id, edition.id, {
      id: 'legacy-match',
      method: 'legacy_isbn',
      status: 'review_required',
      createdBy: 'json_v2_import',
    });
    repository.putIdentificationJob({
      id: 'legacy-job',
      offerId: offer.id,
      status: 'review_required',
    });

    const result = queueHistoricalReidentification(repository, { dryRun: false, limit: 10 });
    assert.equal(result.count, 1);
    assert.equal(result.queued, 1);
    assert.equal(repository.getIdentificationStatus(offer.id).job.status, 'queued');
    assert.equal(repository.getOfferMatchHistory(offer.id)[0].status, 'review_required');
  } finally {
    repository.close();
  }
});
