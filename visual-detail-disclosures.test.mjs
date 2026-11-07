import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const offers = await readFile(new URL('./app/views/offers.js', import.meta.url), 'utf8');
const review = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
const css = await readFile(new URL('./app/app.css', import.meta.url), 'utf8');

test('price evidence and review guidance remain accessible in semantic disclosures', () => {
  for (const script of [offers]) {
    assert.match(script, /<details class="detail-disclosure">/);
    assert.match(script, /<summary>/);
    assert.match(script, /<\/details>/);
  }
  assert.match(offers, /Wielokrotne odczyty tej samej ceny nie są niezależnymi transakcjami/);
  assert.match(offers, /Przed podatkiem, bez gwarancji sprzedaży/);
  assert.match(review, /Sprawdź ISBN/);
  assert.doesNotMatch(review, /class="review-visible-comparison"/);
  assert.doesNotMatch(review, /<details class="lean-review-evidence"/);
  assert.match(review, /id="approveReview"/);
});
test('secondary disclosures retain visible keyboard focus and touch targets', () => {
  assert.match(css, /\.detail-disclosure > summary:focus-visible/);
  assert.match(css, /\.detail-disclosure > summary \{ min-height: 44px/);
});
