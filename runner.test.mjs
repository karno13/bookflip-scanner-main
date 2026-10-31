import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('runner zapisuje cały feed JSON partiami i nie pobiera szczegółów Vinted', async () => {
  const previousFetch = globalThis.fetch,
    previousEnv = { ...process.env },
    calls = [];
  let claimed = false;
  const rows = Array.from({ length: 47 }, (_, i) => ({
    title: 'Warcraft TEST ' + i,
    url: 'https://allegrolokalnie.pl/oferta/test-' + i,
    price: 1000,
    active: true,
    observedAt: new Date().toISOString(),
    isbn: '9780306406157',
  }));
  process.env.BOOKFLIP_SITES_ACCESS = 'fixture';
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://fixture.actions.githubusercontent.com/token';
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'fixture';
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('.actions.githubusercontent.com'))
      return Response.json({ value: 'fixture-oidc' });
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === 'claim') {
      if (claimed) return Response.json({ task: null, tasks: [], active: 0 });
      claimed = true;
      return Response.json({
        task: {
          id: 'task',
          leaseToken: 'lease',
          source: 'Allegro Lokalnie',
          host: 'allegrolokalnie.pl',
          mode: 'discovery',
          category: 'Warcraft',
          adapter: 'json_feed',
          feedUrl: 'https://example.org/feed',
          paginationVersion: 1,
          page: 1,
          pageOffset: 0,
        },
      });
    }
    return Response.json({ automatic: true, active: 0, processing: 0 });
  };
  try {
    const code = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/^import .*;\n/gm, '')
      .replace(/main\(\)\.catch\([\s\S]*$/, 'export {main,offerBatch};');
    const cursor = readFileSync(new URL('./page-cursor.mjs', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/^export /gm, '');
    const prefix =
      cursor +
      `const {createHash}=await import('node:crypto');const {selectOffers}=await import(${JSON.stringify(new URL('./feed.mjs', import.meta.url).href)});const fetchFeed=async()=>${JSON.stringify(rows)};const enrichVintedBatch=async()=>{throw Error('unexpected details');};const dispatchContinuation=async()=>{throw Error('unexpected continuation');};\n`;
    const runner = await import(
      'data:text/javascript;base64,' + Buffer.from(prefix + code).toString('base64')
    );
    await runner.main();
    const large = { description: 'x'.repeat(40000) };
    assert.equal(runner.offerBatch([large, large, large], 0).length, 1);
    assert.throws(
      () => runner.offerBatch([{ description: 'x'.repeat(80000) }], 0),
      /PAYLOAD_TOO_LARGE/,
    );
    const batches = calls.filter((c) => c.action === 'complete');
    assert.equal(batches.length, 16);
    assert.equal(
      batches.reduce((n, b) => n + b.offers.length, 0),
      47,
    );
    assert.deepEqual(
      batches.map((b) => b.pagination.offset),
      Array.from({ length: 16 }, (_, i) => i * 3),
    );
    assert.ok(
      batches.every(
        (b) => b.offers.length <= 3 && b.pagination.total === 47 && b.pagination.state === 'end',
      ),
    );
    assert.ok(batches.every((b) => b.offers.every((o) => o.isbn === '9780306406157')));
  } finally {
    globalThis.fetch = previousFetch;
    process.env = previousEnv;
  }
});
