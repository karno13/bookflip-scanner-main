import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichVintedBatch } from './vinted-detail.mjs';
import { drainProcessing } from './process.mjs';
import { readFileSync } from 'node:fs';
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
test('matching drains successive batches without marketplace calls', async () => {
  let count = 0;
  const calls = [];
  const result = await drainProcessing(
    async (b) => {
      calls.push(b.action);
      if (b.action === 'status') return { automatic: true, processing: count < 2 ? 12 : 0 };
      count++;
      return { processed: count === 1 ? 10 : count === 2 ? 2 : 0 };
    },
    { now: () => 0, log: () => {} },
  );
  assert.equal(result.processed, 12);
  assert.equal(result.remaining, 0);
  assert.ok(calls.every((a) => ['status', 'process'].includes(a)));
});
test('matching exits on paused or retry-delayed queue', async () => {
  for (const automatic of [false, true]) {
    let calls = 0;
    const result = await drainProcessing(
      async (b) => {
        calls++;
        return b.action === 'status' ? { automatic, processing: 3 } : { processed: 0, failed: 0 };
      },
      { now: () => 0, log: () => {} },
    );
    assert.equal(result.remaining, 3);
    assert.equal(calls, automatic ? 3 : 1);
  }
});
test('CI runs offline tests and legacy hosted runner cannot schedule scans in this repo', () => {
  const ci = readFileSync(
    new URL('./.github/workflows/scanner-tests.yml', import.meta.url),
    'utf8',
  );
  assert.match(ci, /run: node --test\s*$/m);
  const workflow = readFileSync(
    new URL('./.github/workflows/bookflip-scan.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /cron:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /github\.repository == 'PJASDEM\/bookflip-scanner'/);
  assert.match(workflow, /group: bookflip-scanner/);
  assert.match(workflow, /group: bookflip-matching/);
});
