import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const offers = await readFile(new URL('./app/views/offers.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('./app/styles.css', import.meta.url), 'utf8');
test('price-history remains available in an expandable offer detail panel', () => {
  assert.match(offers, /class="detail-disclosure price-history-disclosure"/);
  assert.match(offers, /offer\.priceHistory\.length/);
  assert.match(offers, /offer\.priceHistory\.map/);
  assert.match(offers, /Historia zapisanych cen ogłoszenia/);
  assert.match(styles, /\.price-history-disclosure \.price-list/);
});
