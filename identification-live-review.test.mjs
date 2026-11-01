import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('review marks the selected offer as a set and updates review list', async () => {
  const view = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
  assert.match(view, /id="markAsSet"/);
  assert.match(view, /json\('\/api\/sets'/);
  assert.match(view, /await loadCatalogData\(\)/);
});
test('live queue status is refreshed and rendered without manual click', async () => {
  const app = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
  assert.match(app, /identificationProgressBar/);
  assert.match(app, /setInterval\(async \(\) =>/);
  assert.match(app, /lastCatalogDataRefresh/);
});
test('resolver uses single BN ISBN and retains high-confidence conflict gates', async () => {
  const resolver = await readFile(new URL('./catalog-resolver.mjs', import.meta.url), 'utf8');
  assert.match(resolver, /bnRecords.length === 1 && isbnMatches/);
  assert.match(resolver, /context.conflicts.every/);
  assert.match(resolver, /'publisher', 'language', 'binding'/);
});
test('identification workers have bounded network concurrency', async () => {
  const worker = await readFile(new URL('./identification-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /Math.min\(3, limit\)/);
  assert.match(worker, /await Promise.all\(work\)/);
});
