import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, fetchFeed, selectOffers, parseRetryAfter } from './feed.mjs';
import { EventEmitter } from 'node:events';
test('przypięty DNS obsługuje tryb wszystkich adresów Node i odczytuje XML', async () => {
  const address = { address: '8.8.8.8', family: 4 };
  const request = (_url, options, cb) => {
    options.lookup('example.org', { all: true }, (err, rows) => {
      assert.equal(err, null);
      assert.deepEqual(rows, [address]);
    });
    options.lookup('example.org', {}, (err, ip, family) => {
      assert.equal(err, null);
      assert.equal(ip, address.address);
      assert.equal(family, 4);
    });
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-type': 'application/atom+xml' };
      res.setEncoding = () => {};
      cb(res);
      res.emit('data', '<feed/>');
      res.emit('end');
    };
    return req;
  };
  assert.equal(
    await fetchFeed('https://example.org/feed', {
      lookup: async () => [address],
      request,
      format: 'atom',
    }),
    '<feed/>',
  );
});
test('blokuje prywatne i zastrzeżone adresy', () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
});
test('odrzuca niebezpieczne feedy przed odczytem', async () => {
  for (const u of [
    'http://example.com',
    'https://127.0.0.1',
    'https://example.com/?api_key=secret',
    'https://feed.local/',
  ])
    await assert.rejects(() => fetchFeed(u));
  await assert.rejects(() =>
    fetchFeed('https://example.org/feed', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
  );
});
test('importuje tylko aktywne, aktualne, tematyczne oferty danego źródła', () => {
  const good = {
    title: 'Warcraft Dzień Smoka',
    url: 'https://www.vinted.pl/items/123-book',
    price: 3000,
    active: true,
    observedAt: new Date().toISOString(),
  };
  const task = { mode: 'discovery', category: 'Warcraft', host: 'www.vinted.pl' };
  const rows = selectOffers(
    [
      good,
      { ...good, active: false },
      { ...good, url: 'https://evil.example/items/2' },
      { ...good, title: 'Buty' },
      { ...good, price: -1 },
      { ...good, observedAt: '2000-01-01' },
      good,
    ],
    task,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 3000);
});
test('Retry-After jest ograniczony', () => {
  assert.equal(parseRetryAfter('120'), 120);
  assert.equal(parseRetryAfter('9999999'), 86400);
});

test('JSON zachowuje odczytane ISBN, opis, autorów i niepewność bez pól sterujących', () => {
  const row = {
    title: 'Warcraft Dzień Smoka',
    url: 'https://www.vinted.pl/items/123-test',
    price: 3000,
    active: true,
    observedAt: new Date().toISOString(),
    isbn: '9780306406157',
    isbn_10: '0306406152',
    isbns: ['9780306406157'],
    authors: ['TEST Autor'],
    description: 'ISBN 9780306406157',
    volume: '2',
    isbnReadUncertain: true,
    parameters: { ISBN: '9780306406157' },
    editionId: 'forged',
    verified: true,
    scanProcessing: { status: 'completed' },
  };
  const [r] = selectOffers([row], {
    mode: 'discovery',
    category: 'Warcraft',
    host: 'www.vinted.pl',
  });
  for (const key of [
    'isbn',
    'isbn_10',
    'isbns',
    'authors',
    'description',
    'volume',
    'parameters',
    'isbnReadUncertain',
  ])
    assert.deepEqual(r[key], row[key]);
  for (const key of ['editionId', 'verified', 'scanProcessing']) assert.equal(r[key], undefined);
});
test('pełny dokument JSON udostępnia ponad 20 ofert i deduplikuje Vinted po ID', () => {
  const base = {
      title: 'Warcraft',
      price: 1000,
      active: true,
      observedAt: new Date().toISOString(),
    },
    task = { mode: 'discovery', category: 'Warcraft', host: 'www.vinted.pl' };
  const rows = Array.from({ length: 47 }, (_, i) => ({
    ...base,
    url: 'https://www.vinted.pl/items/' + (1000 + i) + '-test',
  }));
  assert.equal(selectOffers(rows, task, Date.now(), 1000).length, 47);
  assert.equal(selectOffers(rows, task).length, 20);
  assert.equal(
    selectOffers(
      [
        rows[0],
        { ...rows[0], url: 'https://www.vinted.pl/items/1000-new?tracking=1' },
        { ...rows[1], currency: 'EUR' },
      ],
      task,
    ).length,
    1,
  );
});
test('JSON odrzuca nieprawidłowe typy metadanych', () => {
  const row = {
    title: 'Warcraft',
    url: 'https://www.vinted.pl/items/123-test',
    price: 1000,
    active: true,
    observedAt: new Date().toISOString(),
  };
  for (const extra of [{ isbn: 123 }, { authors: [{}] }, { isbns: ['x'.repeat(101)] }])
    assert.throws(
      () =>
        selectOffers([{ ...row, ...extra }], {
          mode: 'discovery',
          category: 'Warcraft',
          host: 'www.vinted.pl',
        }),
      /bibliograficzne/,
    );
});
