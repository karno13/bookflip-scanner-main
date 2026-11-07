// A metadata source that stays down (BN served an expired certificate for days) must not trap the
// queue: new offers go first, the backlog is retried less and less often, and it wakes up as soon
// as BN answers again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { IdentificationWorker } from './identification-worker.mjs';

function setup(now) {
  const repository = new SqliteCatalogRepository(':memory:');
  const add = (id, attempts, createdAt) => {
    const offer = repository.upsertOffer({ source: 'test', normalizedUrl: `https://example.test/${id}`, originalTitle: id });
    repository.database
      .prepare(
        "INSERT INTO identification_jobs(id,offer_id,job_type,status,attempt_count,created_at,updated_at) VALUES(?,?,'identify_edition','queued',?,?,?)",
      )
      .run(id, offer.id, attempts, createdAt, createdAt);
  };
  add('old-retry', 60, '2026-01-01T00:00:00.000Z');
  add('fresh', 0, '2026-01-02T00:00:00.000Z');
  let clock = now;
  const results = [];
  const worker = new IdentificationWorker({
    repository,
    now: () => clock,
    retryDelayMs: 5 * 60_000,
    resolver: { resolve: async ({ offerId }) => results.shift()?.(offerId) },
  });
  return { repository, worker, results, setClock: (value) => { clock = value; } };
}

const down = () => ({ decision: 'retry_pending', reason: ['metadata_source_temporary_error'], evidence: { bnStatus: 'temporary_error' } });
const job = (repository, id) => repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(id);

test('fresh jobs are claimed before a long retry backlog', async () => {
  const { repository, worker, results } = setup(new Date('2026-01-03T00:00:00Z'));
  try {
    results.push(down);
    const first = await worker.processNext();
    assert.equal(first.job.id, 'fresh');
  } finally {
    repository.close();
  }
});

test('repeated outages back off to at most an hour', async () => {
  const now = new Date('2026-01-03T00:00:00Z');
  const { repository, worker, results } = setup(now);
  try {
    results.push(down, down);
    await worker.processNext(); // fresh: attempt 1 -> 5 min
    await worker.processNext(); // old: attempt 61 -> capped at 60 min
    assert.equal(Date.parse(job(repository, 'fresh').run_after) - now.getTime(), 5 * 60_000);
    assert.equal(Date.parse(job(repository, 'old-retry').run_after) - now.getTime(), 60 * 60_000);
  } finally {
    repository.close();
  }
});

test('an answer from BN wakes up the jobs waiting out its outage', async () => {
  const now = new Date('2026-01-03T00:00:00Z');
  const { repository, worker, results, setClock } = setup(now);
  try {
    results.push(down, down);
    await worker.processNext();
    await worker.processNext();
    // A new offer arrives later and BN answers for it.
    const later = new Date(now.getTime() + 2 * 60_000);
    setClock(later);
    const offer = repository.upsertOffer({ source: 'test', normalizedUrl: 'https://example.test/new', originalTitle: 'new' });
    repository.database
      .prepare("INSERT INTO identification_jobs(id,offer_id,job_type,status,created_at,updated_at) VALUES('new',?,'identify_edition','queued',?,?)")
      .run(offer.id, later.toISOString(), later.toISOString());
    results.push(() => ({ decision: 'review_required', reason: ['no_isbn_evidence'], evidence: { bnStatus: 'not_found' } }));
    await worker.processNext();
    assert.equal(job(repository, 'fresh').run_after, later.toISOString());
    assert.equal(job(repository, 'old-retry').run_after, later.toISOString());
  } finally {
    repository.close();
  }
});
