import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAppServer } from './local-app.mjs';

test('scan status and catalog summary endpoints return lightweight JSON', async () => {
  const server = createLocalAppServer({
    catalogProvider: () => ({ repository: { counts: () => ({ offers: 42, works: 12 }) } }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const summary = await fetch(base + '/api/catalog/summary');
    assert.equal(summary.status, 200);
    assert.deepEqual(await summary.json(), { offers: 42, works: 12 });
    const status = await fetch(base + '/api/scan/status');
    assert.equal(status.status, 200);
    assert.equal(typeof (await status.json()).status, 'string');
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
