import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DETAIL_SOURCES, parseProductDetail } from './source-details.mjs';

const fixture = readFileSync(new URL('./fixtures/details/tezeusz-product.html', import.meta.url), 'utf8');
const ld = (body) => `<script type="application/ld+json">${JSON.stringify(body)}</script>`;

test('Tezeusz product page yields the ISBN and bibliographic facts from JSON-LD', () => {
  const detail = parseProductDetail(fixture);
  assert.equal(detail.isbn, '9788388916014');
  assert.equal(detail.isbnSource, 'json-ld');
  assert.equal(detail.title, 'Warcraft Dzień smoka');
  assert.deepEqual(detail.authors, ['Richard A. Knaak']);
  assert.equal(detail.publisher, 'ISA');
  assert.equal(detail.year, 2001);
  assert.equal(detail.pages, 399);
  assert.equal(detail.binding, 'Miękka');
  assert.equal(detail.condition, 'Używana');
  assert.ok(DETAIL_SOURCES.has('Tezeusz.pl'));
});

test('a non-book EAN is not accepted as an ISBN', () => {
  // 5902768001237-style game barcodes are valid EAN-13 but not 978/979.
  const html = ld({ '@type': ['Product', 'Book'], name: 'Gra', gtin13: '5901234123457' });
  assert.equal(parseProductDetail(html).isbn, null);
});

test('an invalid checksum is rejected', () => {
  const html = ld({ '@type': ['Product', 'Book'], name: 'Książka', gtin13: '9788388916015' });
  assert.equal(parseProductDetail(html).isbn, null);
});

test('ISBN written in a free-text description or an image URL is never used', () => {
  const html = `<html><body><img src="https://img/x-ISBN-9788383433578.jpg" alt="ISBN 9788383433578">
    <p>Opis: ISBN 9788383433578</p></body></html>`;
  assert.equal(parseProductDetail(html).isbn, null);
});

test('malformed JSON-LD is skipped and the labelled EAN attribute is used instead', () => {
  const html = `<script type="application/ld+json">{broken</script>
    <span class="single-product__attribute-item">EAN: <span class="single-product__attribute-value">9788388916014</span></span>`;
  const detail = parseProductDetail(html);
  assert.equal(detail.isbn, '9788388916014');
  assert.equal(detail.isbnSource, 'attribute');
});

test('Product nodes without any book markup are ignored', () => {
  assert.equal(parseProductDetail(ld({ '@type': 'Product', name: 'Zakładka' })).isbn, null);
  assert.equal(parseProductDetail('').isbn, null);
});
