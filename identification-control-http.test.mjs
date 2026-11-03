import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAppServer } from './local-app.mjs';
import { createProductionCatalog } from './catalog-production.mjs';
import { createIdentificationScheduler } from './identification-scheduler.mjs';

test('HTTP start and stop control the real identification scheduler', async () => {
  const catalog = createProductionCatalog({ databasePath: ':memory:', fetcher: async () => {
    throw Error('NETWORK_NOT_ALLOWED');
  } });
  let runs = 0;
  const scheduler = createIdentificationScheduler({
    runBatch: async () => { runs++; return { processed: 0 }; },
  });
  const server = createLocalAppServer({
    catalogProvider: () => catalog,
    identificationControl: scheduler,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const control = (action) => fetch(base + '/api/identification/control', {
    method: 'POST', headers, body: JSON.stringify({ action }),
  });
  try {
    assert.equal((await (await fetch(base + '/api/catalog/status', { headers })).json()).scheduler.running, false);
    const start = await control('start');
    assert.equal(start.status, 200);
    assert.equal((await start.json()).running, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runs, 1);
    const stop = await control('stop');
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).paused, true);
    assert.equal((await (await fetch(base + '/api/catalog/status', { headers })).json()).scheduler.running, false);
    const wrong = await control('invalid');
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, 'INVALID_IDENTIFICATION_ACTION');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runs, 1);
  } finally {
    await scheduler.stop();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    catalog.close();
  }
});
