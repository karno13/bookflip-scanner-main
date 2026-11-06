import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('identification controls, metrics and retry exist once and belong to review', () => {
  const html = readFileSync(new URL('./app/index.html', import.meta.url), 'utf8');
  const review = html.split('id="view-review"')[1].split('id="view-catalog"')[0];
  const settings = html.split('id="view-settings"')[1];
  for (const id of ['identificationStart', 'identificationStop', 'identificationProgressBar',
    'identificationAssigned', 'identificationPending', 'identificationFailed',
    'scanIsbnCreated', 'scanIsbnReview', 'scanIsbnNotFound', 'retryIdentification']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
    assert.ok(review.includes(`id="${id}"`), id);
    assert.ok(!settings.includes(`id="${id}"`), id);
  }
  assert.match(review, /id="identificationStop"[^>]*>Anuluj/);
});
