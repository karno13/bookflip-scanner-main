import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { createProductionCatalog } from './catalog-production.mjs';

test('scan center displays catalog-wide ISBN counts and review reasons', async () => {
  const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./app/views/scan-insights.js', import.meta.url), 'utf8');
  for (const id of ['scanIsbnMatched', 'scanIsbnCreated', 'scanIsbnReview', 'scanIsbnNotFound', 'scanIsbnReasons', 'scanIsbnFailures'])
    assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(ui, /\/api\/catalog\/status/);
  assert.match(ui, /created_work_and_edition/);
  assert.match(ui, /reviewReasons/);
  assert.match(ui, /lastIsbnRefresh/);
});
test('review reasons come from actual durable decision JSON, not offer count', async () => {
  const source = await readFile(new URL('./catalog-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /json_each\(CASE WHEN json_valid/);
  assert.match(source, /j\.status='review_required'/);
  assert.match(source, /reviewReasons/);
  assert.match(source, /other_reason/);
});
