import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  safeImageUrl,
  proxiedImage,
  imageFromDetailHtml,
  fetchCachedImage,
  offerImageUrl,
} from './offer-images.mjs';
import { parseMarketplace } from './marketplaces.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('accepts only marketplace CDN images over https', () => {
  assert.equal(
    safeImageUrl('https://images1.vinted.net/t/abc/310x430/x.webp?s=1'),
    'https://images1.vinted.net/t/abc/310x430/x.webp?s=1',
  );
  assert.equal(safeImageUrl({ url: 'https://a.allegroimg.com/original/1/2' }), 'https://a.allegroimg.com/original/1/2');
  assert.equal(safeImageUrl(['https://dedalus.pl/img/a.jpg']), 'https://dedalus.pl/img/a.jpg');
  assert.equal(safeImageUrl('//ecsmedia.pl/cir/p/a.webp'), 'https://ecsmedia.pl/cir/p/a.webp');
  assert.equal(safeImageUrl('https://evil.example/a.jpg'), null);
  assert.equal(safeImageUrl('https://user:pw@ecsmedia.pl/a.jpg'), null);
  assert.equal(safeImageUrl('/b/mp/img/svg/no_picture.svg'), null);
  assert.equal(safeImageUrl('https://tezeusz.pl/img/empty-photo.svg'), null);
  assert.equal(safeImageUrl(42), null);
  assert.equal(proxiedImage('https://ecsmedia.pl/a.webp'), '/api/image?u=https%3A%2F%2Fecsmedia.pl%2Fa.webp');
});

test('reads og:image or JSON-LD image from a detail page', () => {
  assert.equal(
    imageFromDetailHtml('<meta property="og:image" content="https://a.allegroimg.com/s400/x">'),
    'https://a.allegroimg.com/s400/x',
  );
  assert.equal(
    imageFromDetailHtml('<script>{"image": ["https://dedalus.pl/img/b.jpg"]}</script>'),
    'https://dedalus.pl/img/b.jpg',
  );
  assert.equal(imageFromDetailHtml('<meta property="og:image" content="https://x.example/a.jpg">'), null);
  assert.equal(
    imageFromDetailHtml('<meta property="og:image" content=https://a.allegroimg.com/original/1e9edf/e29f>'),
    'https://a.allegroimg.com/original/1e9edf/e29f',
  );
});

test('Tezeusz card image skips the onerror placeholder', () => {
  const html = `<a class='tezeusz-product-card js-ga' href='mafin-i-urgi-1'><img loading="lazy" src="https://static6.tezeusz.pl/a.jpeg" onerror="this.src='/img/empty-photo.svg'" alt="Mafin i Urgi"><div class="tezeusz-product-card-price">29,99 zł</div></a>`;
  const rows = parseMarketplace(html, { source: 'Tezeusz.pl', host: 'tezeusz.pl', mode: 'watchlist', title: 'Mafin' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].image, 'https://static6.tezeusz.pl/a.jpeg');
});

test('image proxy caches the body and rejects non-images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bookflip-img-'));
  try {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } });
    };
    const url = 'https://images1.vinted.net/t/a/x.webp';
    const first = await fetchCachedImage(url, { cacheDirectory: dir, fetcher });
    const second = await fetchCachedImage(url, { cacheDirectory: dir, fetcher });
    assert.equal(first.type, 'image/webp');
    assert.deepEqual([...second.body], [1, 2, 3]);
    assert.equal(calls, 1);
    await assert.rejects(fetchCachedImage('https://evil.example/a.jpg', { cacheDirectory: dir, fetcher }), /NOT_ALLOWED/);
    const html = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchCachedImage('https://ecsmedia.pl/b.webp', { cacheDirectory: dir, fetcher: html }), /NOT_FOUND/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stores scanned image and backfills a missing one from the listing page once', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const stored = repository.upsertOffer({
      source: 'Vinted',
      normalizedUrl: 'https://www.vinted.pl/items/1',
      originalTitle: 'Kolor magii',
      currentPrice: 1000,
      imageUrl: 'https://images1.vinted.net/t/a/1.webp',
    });
    assert.equal(stored.image_url, 'https://images1.vinted.net/t/a/1.webp');
    const again = repository.upsertOffer({ id: stored.id, source: 'Vinted', normalizedUrl: 'https://www.vinted.pl/items/1', currentPrice: 900 });
    assert.equal(again.image_url, 'https://images1.vinted.net/t/a/1.webp');
    const bare = repository.upsertOffer({ source: 'OLX', normalizedUrl: 'https://www.olx.pl/d/oferta/x', originalTitle: 'x', currentPrice: 500 });
    let reads = 0;
    const readHtml = async () => {
      reads += 1;
      return '<meta property="og:image" content="https://ireland.apollo.olxcdn.com/v1/files/a/image">';
    };
    assert.equal(await offerImageUrl(repository, bare.id, { readHtml }), 'https://ireland.apollo.olxcdn.com/v1/files/a/image');
    assert.equal(await offerImageUrl(repository, bare.id, { readHtml }), 'https://ireland.apollo.olxcdn.com/v1/files/a/image');
    assert.equal(reads, 1);
  } finally {
    repository.close?.();
  }
});
