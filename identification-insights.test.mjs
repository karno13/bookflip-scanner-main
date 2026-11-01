import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('identification outcome aggregation distinguishes completion without matching', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE identification_jobs(status TEXT NOT NULL, result_json TEXT)');
    const add = db.prepare('INSERT INTO identification_jobs(status,result_json) VALUES (?,?)');
    add.run('completed', JSON.stringify({decision:'not_found'}));
    add.run('completed', JSON.stringify({decision:'matched_existing'}));
    add.run('completed', JSON.stringify({decision:'created_work_and_edition'}));
    add.run('review_required', JSON.stringify({decision:'review_required'}));
    add.run('retry_wait', null);
    const status = Object.fromEntries(db.prepare(
      "SELECT status, count(*) AS count FROM identification_jobs GROUP BY status",
    ).all().map(row => [row.status, Number(row.count)]));
    const decisions = Object.fromEntries(db.prepare(
      "SELECT json_extract(result_json, '$.decision') AS decision, count(*) AS count FROM identification_jobs WHERE status='completed' AND json_valid(result_json) GROUP BY decision",
    ).all().filter(row => row.decision).map(row => [row.decision, Number(row.count)]));
    assert.deepEqual(status, {completed:3, review_required:1, retry_wait:1});
    assert.deepEqual(decisions, {not_found:1, matched_existing:1, created_work_and_edition:1});
  } finally {
    db.close();
  }
});

test('review includes read-only external lookup and preserves approval flow', async () => {
  const review = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
  const server = await readFile(new URL('./local-app.mjs', import.meta.url), 'utf8');
  assert.match(review, /reviewExternalIsbnButton/);
  assert.match(review, /\/api\/catalog\/lookup-preview/);
  assert.match(review, /przypisanie wymaga osobnego zatwierdzenia/);
  assert.match(review, /approveReview/);
  assert.match(server, /durationMs: Math.round\(performance.now\(\) - startedAt\)/);
});
