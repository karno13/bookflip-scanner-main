import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { createSkupksiazekClient, quoteFromCart } from './buyback-skupksiazek.mjs';
import { createBuybackService } from './buyback-quotes.mjs';

const ISBN = '9788361656487';

function fakeSite({ price = 4.5, failFirstPost = 0, reject = null } = {}) {
  const calls = [];
  let cart = [];
  let posts = 0;
  const reply = (status, body, cookies = []) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => cookies },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ method: init.method || 'GET', path, headers: init.headers, body: init.body });
    if (path === '/') return reply(200, '<meta name="csrf-token" content="tok123">', ['XSRF-TOKEN=x%3D1; path=/', 'skup_session=s1; HttpOnly']);
    if (init.method === 'POST') {
      posts += 1;
      if (posts <= failFirstPost) return reply(419, { message: 'CSRF token mismatch.' });
      if (reject) return reply(422, { message: reject });
      const isbn = JSON.parse(init.body).isbn;
      cart.push({ id: 77, isbn, title: 'Łowca czarownic', author: 'Pilipiuk', price, quantity: 1 });
      return reply(200, { cart: { code: 'AB12', items: cart } });
    }
    if (init.method === 'DELETE') {
      cart = cart.filter((item) => String(item.id) !== path.split('/').pop());
      return reply(200, { cart: { code: 'AB12', items: cart } });
    }
    return reply(404, {});
  };
  return { fetch, calls, cart: () => cart };
}

test('quote reads the cart item price and leaves the cart empty', async () => {
  const site = fakeSite();
  const client = createSkupksiazekClient({ fetch: site.fetch, minIntervalMs: 0 });
  const quote = await client.quote('978-83-61656-48-7');
  assert.deepEqual(quote, { status: 'priced', price: 4.5, title: 'Łowca czarownic — Pilipiuk', message: null });
  assert.equal(site.cart().length, 0);
  const post = site.calls.find((call) => call.method === 'POST');
  assert.equal(post.path, '/cart/0');
  assert.equal(post.headers['X-CSRF-TOKEN'], 'tok123');
  assert.equal(post.headers['X-XSRF-TOKEN'], 'x=1');
  assert.match(post.headers.Cookie, /skup_session=s1/);
  // Second quote reuses the session and the cart.
  await client.quote(ISBN);
  assert.equal(site.calls.filter((call) => call.path === '/').length, 1);
  assert.equal(site.calls.filter((call) => call.method === 'POST').at(-1).path, '/cart/AB12');
});

test('expired CSRF session is renewed once; refusal and hand pricing are reported', async () => {
  const renewed = fakeSite({ failFirstPost: 1 });
  assert.equal((await createSkupksiazekClient({ fetch: renewed.fetch, minIntervalMs: 0 }).quote(ISBN)).status, 'priced');
  assert.equal(renewed.calls.filter((call) => call.path === '/').length, 2);
  const refused = fakeSite({ reject: 'Nie skupujemy tej książki' });
  assert.deepEqual(await createSkupksiazekClient({ fetch: refused.fetch, minIntervalMs: 0 }).quote(ISBN), {
    status: 'not_bought', price: null, title: null, message: 'Nie skupujemy tej książki',
  });
  assert.equal(quoteFromCart({ cart: { items: [{ isbn: ISBN, price: 9, exceeds_client_price_limit: true }] } }, ISBN).status, 'manual');
  assert.equal(quoteFromCart({ cart: { items: [{ item_isbn: ISBN, price: 6, quantity: 2 }] } }, ISBN).price, 3);
});

test('service caches quotes for a week, keeps a good quote on failure and batches catalogue ISBNs', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({ title: 'Łowca czarownic' });
    const edition = repo.createEdition({ workId: work.id, title: 'Łowca czarownic' });
    repo.database.prepare("INSERT INTO edition_identifiers (edition_id,scheme,normalized_value,source,verification_status,created_at) VALUES (?,?,?,?,?,?)")
      .run(edition.id, 'isbn13', ISBN, 'test', 'verified', new Date().toISOString());
    let clock = Date.parse('2026-11-07T10:00:00Z');
    let calls = 0;
    let fail = false;
    const client = { quote: async () => { calls += 1; if (fail) throw new Error('HTTP 503'); return { status: 'priced', price: 3.2, title: 'Ł', message: null }; } };
    const service = createBuybackService(repo, client, { now: () => clock });
    assert.equal(service.pending().length, 1);
    assert.equal((await service.check(ISBN)).price, 3.2);
    await service.check(ISBN);
    assert.equal(calls, 1, 'fresh quote served from cache');
    assert.equal(service.pending().length, 0);
    clock += 8 * 24 * 3_600_000;
    assert.equal(service.get(ISBN).stale, true);
    fail = true;
    const kept = await service.check(ISBN);
    assert.equal(kept.price, 3.2);
    assert.equal(kept.refreshError, 'HTTP 503');
    fail = false;
    service.start();
    while (service.status().state === 'running') await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.status().priced, 1);
    assert.deepEqual(service.status().summary, { isbns: 1, priced: 1, manual: 0, notBought: 0, pricedValue: 3.2, pending: 0 });
    assert.deepEqual(Object.keys(service.many([ISBN, 'zzz'])), [ISBN]);
  } finally {
    repo.close?.();
  }
});

test('automatic mode quotes new ISBNs on its own, can be switched off and pauses after repeated errors', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({ title: 'X' });
    const addIsbn = (isbn) => {
      const edition = repo.createEdition({ workId: work.id, title: 'X ' + isbn });
      repo.database.prepare("INSERT INTO edition_identifiers (edition_id,scheme,normalized_value,source,verification_status,created_at) VALUES (?,?,?,?,?,?)")
        .run(edition.id, 'isbn13', isbn, 'test', 'verified', new Date().toISOString());
    };
    addIsbn(ISBN);
    let fail = false;
    const timers = [];
    const client = { quote: async () => { if (fail) throw new Error('HTTP 403'); return { status: 'priced', price: 2, title: null, message: null }; } };
    const service = createBuybackService(repo, client, { setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {} });
    assert.equal(service.status().auto, true, 'on by default');
    const fire = async () => { timers.shift()(); await service.idle(); };
    service.startAuto();
    await fire();
    assert.equal(service.status().summary.priced, 1);
    // A newly catalogued edition gets quoted on the next tick.
    addIsbn('9788375780123');
    await fire();
    assert.equal(service.status().summary.priced, 2);
    service.setAuto(false);
    addIsbn('9788375780130');
    timers.length = 0;
    service.startAuto();
    await fire();
    assert.equal(service.status().summary.pending, 1, 'switched off: nothing quoted');
    service.setAuto(true);
    fail = true;
    for (const isbn of ['9788375780147', '9788375780154', '9788375780161', '9788375780178']) addIsbn(isbn);
    timers.length = 0;
    service.startAuto();
    await fire();
    assert.ok(service.status().autoPausedUntil, 'paused after 5 errors in a row');
    await fire();
    assert.equal(service.status().done, 5, 'no new run while paused');
    service.stopAuto();
  } finally {
    repo.close?.();
  }
});
