import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { retryIdentificationJobs } from './identification-retry.mjs';
import { IdentificationWorker } from './identification-worker.mjs';

test('retry unresolved resets exhausted jobs and allows repeated identification', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    for (const [id, status, decision] of [
      ['failed', 'failed', null], ['review', 'review_required', 'review_required'],
      ['missing', 'completed', 'not_found'], ['waiting', 'retry_wait', null],
      ['done', 'completed', 'matched_existing'], ['active', 'running', null],
    ]) {
      repository.upsertOffer({ id, source: 'test', normalizedUrl: `https://example.test/${id}`, originalTitle: id });
      repository.putIdentificationJob({ id, offerId: id, status, attemptCount: 9 });
      if (decision) repository.database.prepare('UPDATE identification_jobs SET result_json=? WHERE id=?').run(JSON.stringify({ decision }), id);
    }
    assert.equal(retryIdentificationJobs(repository, 'unresolved').queued, 4);
    const job = repository.database.prepare("SELECT * FROM identification_jobs WHERE id='failed'").get();
    assert.equal(job.attempt_count, 0);
    assert.equal(job.result_json, null);
    const worker = new IdentificationWorker({ repository, resolver: { resolve: async () => ({ decision: 'not_found' }) } });
    await worker.processBatch(4);
    assert.equal(retryIdentificationJobs(repository, 'unresolved').queued, 4);
    assert.equal(repository.database.prepare("SELECT status FROM identification_jobs WHERE id='done'").get().status, 'completed');
    assert.equal(repository.database.prepare("SELECT status FROM identification_jobs WHERE id='active'").get().status, 'running');
    assert.throws(() => retryIdentificationJobs(repository, 'everything'), /INVALID_RETRY_MODE/);
  } finally { repository.close(); }
});
