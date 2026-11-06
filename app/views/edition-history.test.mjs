import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRows, readObservationBatch } from './edition-history.js';

test('edition history preserves repeated observations and distinguishes their offers', () => {
  const offers = [
    { id: 'a', source: 'A', priceHistory: [{ price: 1000, observedAt: '2026-01-01' }, { price: 1000, observedAt: '2026-01-03' }] },
    { id: 'b', source: 'B', priceHistory: [{ price: 1500, observedAt: '2026-01-02' }] },
    { id: 'c', currentPrice: 4000 },
  ];
  const rows = historyRows(offers);
  assert.deepEqual(rows.map(row => row.offerId), ['a', 'b', 'a']);
  assert.deepEqual(rows.map(row => row.price), [1000, 1500, 1000]);
  assert.equal(offers[0].priceHistory[0].observedAt, '2026-01-01');
  assert.deepEqual(historyRows([]), []);
});

test('history reads are bounded and partial failures retain successful observations', async () => {
  let running = 0, peak = 0, calls = 0;
  const input = Array.from({ length: 25 }, (_, index) => ({ id: String(index) }));
  const result = await readObservationBatch(input, async path => {
    calls++; running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 1));
    running--;
    if (path.endsWith('/3')) throw Error('Temporary failure');
    return { id: path.split('/').at(-1), priceHistory: [] };
  });
  assert.equal(calls, 20);
  assert.equal(peak, 4);
  assert.equal(result.offers.length, 19);
  assert.equal(result.failures, 1);
});
