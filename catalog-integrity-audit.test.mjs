import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { decideIdentificationJob, listCatalogWorks } from './catalog-api.mjs';

test('not_book decision supersedes any active offer-to-edition match', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({ title: 'Test', authors: ['Author'] });
    const edition = repo.createEdition({ workId: work.id, title: 'Test edition' });
    const offer = repo.upsertOffer({ source: 'test', normalizedUrl: 'https://example.test/book', originalTitle: 'Test', currentPrice: 1000 });
    const id = offer.id;
    repo.assignOfferToEdition(id, edition.id, { method: 'metadata', status: 'active' });
    const job = repo.putIdentificationJob({ offerId: id, status: 'review_required' });
    decideIdentificationJob(repo, job.id, { action: 'not_book' });
    const active = repo.database.prepare("SELECT count(*) AS count FROM offer_matches WHERE offer_id=? AND status='active'").get(id).count;
    assert.equal(active, 0);
    assert.equal(repo.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get(job.id).status, 'completed');
  } finally { repo.close(); }
});

test('audit fixes keep separate manual stats and SQLite remote edition lookup', async () => {
  const production = await readFile(new URL('./catalog-production.mjs', import.meta.url), 'utf8');
  const review = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('./identification-worker.mjs', import.meta.url), 'utf8');
  assert.match(production, /manualDecisions/);
  assert.match(review, /\/api\/catalog\/works\?/);
  assert.match(review, /state\.selectedReviewId !== job\.id/);
  assert.match(worker, /maxAttempts = 5/);
  assert.match(worker, /shouldRetry/);
});
