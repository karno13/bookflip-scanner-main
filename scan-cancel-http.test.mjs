import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAppServer } from './local-app.mjs';
import { createProductionCatalog } from './catalog-production.mjs';

test('cancellation endpoint stops an active HTTP scan without replacing its result', async () => {
  const catalog = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => { throw Error('NETWORK_NOT_ALLOWED'); },
  });
  let started;
  let finish;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const search = async () => {
    calls += 1;
    started();
    if (calls === 1) await pending;
    return {
      results: [{ source: 'Empik', query: 'Warcraft', status: 'ok' }],
      offers: [], searchedAt: new Date().toISOString(), summary: { offers: 0 },
    };
  };
  const server = createLocalAppServer({ catalogProvider: () => catalog, search });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const post = () => fetch(base + '/api/search', {
    method: 'POST', headers,
    body: JSON.stringify({ queries: ['Warcraft'], sources: ['Empik'] }),
  });
  try {
    const first = post();
    await startedPromise;
    const stop = await fetch(base + '/api/search/cancel', { method: 'POST', headers });
    assert.equal(stop.status, 202);
    assert.deepEqual(await stop.json(), { status: 'cancelling' });
    const cancelled = await first;
    assert.equal(cancelled.status, 409);
    assert.deepEqual(await cancelled.json(), { error: 'SCAN_CANCELLED' });
    const status = await (await fetch(base + '/api/scan/status', { headers })).json();
    assert.equal(status.status, 'cancelled');
    const second = await post();
    assert.equal(second.status, 200);
    assert.equal(calls, 2);
  } finally {
    finish();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    catalog.close();
  }
});
