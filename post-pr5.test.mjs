import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOffers } from './feed.mjs';
import { readSourceHtml } from './marketplaces.mjs';

test('empty JSON watchlist cannot import unrelated books', () => {
  const row = {
    title: 'Unrelated book',
    active: true,
    url: 'https://www.vinted.pl/items/1-book',
    price: 1000,
    observedAt: new Date().toISOString(),
  };
  for (const title of ['', '   '])
    assert.deepEqual(selectOffers([row], { host: 'www.vinted.pl', mode: 'watchlist', title }), []);
});

test('unreadable 403 body preserves a stop and the server cooldown', async () => {
  let calls = 0;
  await assert.rejects(
    readSourceHtml('https://www.vinted.pl/catalog/2312-books', {
      source: 'Vinted',
      pause: async () => {},
      fetcher: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(Error('connection reset'));
            },
          }),
          { status: 403, headers: { 'retry-after': '600' } },
        );
      },
    }),
    (e) => e.status === 403 && e.blocked === true && e.retryAfter === 600,
  );
  assert.equal(calls, 1);
});
