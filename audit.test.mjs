import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichVintedBatch } from './vinted-detail.mjs';
import { readFileSync, existsSync } from 'node:fs';
const offers = [1, 2, 3].map((id) => ({
  url: `https://www.vinted.pl/items/${id}-book`,
  title: 'Book',
  price: 1000,
}));
test('PR5: optional detail timeout preserves every listing', async () => {
  const result = await enrichVintedBatch(offers, {
    bestEffort: true,
    reader: async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    },
  });
  assert.deepEqual(
    result.map((o) => o.url),
    offers.map((o) => o.url),
  );
  assert.ok(result.every((o) => /ponowne sprawdzenie/.test(o.description) && !o.isbn));
});
for (const status of [403, 429])
  test(`best effort must propagate HTTP ${status} and stop further detail reads`, async () => {
    let calls = 0;
    const error = Object.assign(Error('SOURCE_HTTP_' + status), {
      status,
      retryable: true,
      blocked: false,
      retryAfter: 180,
    });
    await assert.rejects(
      enrichVintedBatch(offers, {
        bestEffort: true,
        reader: async () => {
          calls++;
          throw error;
        },
      }),
      (e) => e === error,
    );
    assert.equal(calls, 1);
  });
test('best effort never swallows CAPTCHA', async () => {
  const error = Object.assign(Error('SOURCE_CAPTCHA'), { blocked: true });
  await assert.rejects(
    enrichVintedBatch(offers, {
      bestEffort: true,
      reader: async () => {
        throw error;
      },
    }),
    (e) => e === error,
  );
});
test('CI runs offline tests and legacy hosted runner cannot schedule scans in this repo', () => {
  const ci = readFileSync(
    new URL('./.github/workflows/scanner-tests.yml', import.meta.url),
    'utf8',
  );
  assert.match(ci, /run: npm test\s*$/m);
  assert.equal(existsSync(new URL('./.github/workflows/bookflip-scan.yml', import.meta.url)), false);
});
