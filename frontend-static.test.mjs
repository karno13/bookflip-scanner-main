import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAppServer } from './local-app.mjs';

test('frontend module routes work and server does not expose arbitrary files', async () => {
  const server = createLocalAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const route of ['/app.js', '/views/scanner.js', '/views/settings.js', '/core/formatters.js', '/views/review.js', '/views/catalog.js', '/views/offers.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    const forbidden = await fetch(base + '/package.json');
    assert.equal(forbidden.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
