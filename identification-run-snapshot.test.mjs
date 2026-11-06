import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionCatalog } from './catalog-production.mjs';

test('run snapshot tracks only its jobs and ignores later manual changes and new jobs', async () => {
  const catalog = createProductionCatalog({ databasePath: ':memory:' });
  try {
    const repo = catalog.repository;
    const offer = repo.upsertOffer({ id: 'first', source: 'test', normalizedUrl: 'https://example.test/first', originalTitle: 'First' });
    repo.putIdentificationJob({ id: 'job-first', offerId: offer.id, status: 'queued' });
    const startedAt = new Date().toISOString();
    catalog.beginIdentificationRun(startedAt);
    catalog.resolver.resolve = async () => ({ decision: 'review_required', reason: ['no_isbn_evidence'] });
    await catalog.processQueued(1);
    const another = repo.upsertOffer({ id: 'second', source: 'test', normalizedUrl: 'https://example.test/second', originalTitle: 'Second' });
    repo.putIdentificationJob({ id: 'job-second', offerId: another.id, status: 'queued' });
    repo.database.prepare("UPDATE identification_jobs SET status='completed',result_json=? WHERE id='job-first'")
      .run(JSON.stringify({ manualDecision: 'excluded' }));
    const run = catalog.status({ runStartedAt: startedAt }).identification.run;
    assert.deepEqual(run.statuses, { review_required: 1 });
    assert.deepEqual(run.decisions, { review_required: 1 });
  } finally { catalog.close(); }
});

test('manual decisions and worker claims update pending run items', () => {
  const catalog = createProductionCatalog({ databasePath: ':memory:' });
  try {
    const repo = catalog.repository;
    for (const id of ['manual', 'running']) {
      const offer = repo.upsertOffer({ id, source: 'test', normalizedUrl: `https://example.test/${id}`, originalTitle: id });
      repo.putIdentificationJob({ id: `job-${id}`, offerId: offer.id, status: 'queued' });
    }
    const startedAt = new Date().toISOString();
    catalog.beginIdentificationRun(startedAt);
    repo.database.prepare("UPDATE identification_jobs SET status='completed',result_json=? WHERE id='job-manual'")
      .run(JSON.stringify({ manualDecision: 'excluded' }));
    repo.database.prepare("UPDATE identification_jobs SET status='running' WHERE id='job-running'").run();
    const run = catalog.status({ runStartedAt: startedAt }).identification.run;
    assert.deepEqual(run.statuses, { completed: 1, running: 1 });
    assert.deepEqual(run.decisions, { excluded: 1 });
  } finally { catalog.close(); }
});
