import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonRequester } from './metadata-http.mjs';
import {
  compareMetadataResults,
  lookupISBN,
  persistMetadataResults,
  SqliteMetadataCache,
} from './metadata-lookup.mjs';
import { buildNormalizedRecord, payloadHash } from './metadata-record.mjs';
import { createBnAdapter } from './metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from './metadata-sources/open-library.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const ISBN = '9780306406157';
const OTHER_ISBN = '9783161484100';

function bnRecord(overrides = {}) {
  return {
    id: 'bn-1',
    isbnIssn: [ISBN],
    title: 'Theoretical Physics',
    authors: ['Georg Joos'],
    publisher: 'Dover Publications',
    publicationYear: '1986',
    language: 'eng',
    kind: 'book',
    ...overrides,
  };
}

function edition(overrides = {}) {
  return {
    key: '/books/OL1M',
    title: 'Theoretical Physics',
    isbn_13: [ISBN],
    works: [{ key: '/works/OL1W' }],
    authors: [{ key: '/authors/OL1A' }],
    publishers: ['Dover Publications'],
    publish_date: '1986',
    languages: [{ key: '/languages/eng' }],
    physical_format: 'Paperback',
    ...overrides,
  };
}

function olRequester(overrides = {}) {
  return async (url) => {
    if (url.includes('/isbn/'))
      return { status: 'found', payload: overrides.edition ?? edition(), url };
    if (url.includes('/works/'))
      return {
        status: 'found',
        payload: overrides.work ?? {
          key: '/works/OL1W',
          authors: [{ author: { key: '/authors/OL1A' } }],
        },
        url,
      };
    if (url.includes('/authors/'))
      return {
        status: 'found',
        payload: overrides.author ?? { key: '/authors/OL1A', name: 'Georg Joos' },
        url,
      };
    throw new Error(`unexpected URL ${url}`);
  };
}

function normalized(source, overrides = {}) {
  const payload = overrides.payload ?? { source };
  return {
    ...buildNormalizedRecord({
      source,
      externalRecordId: source === 'bn' ? 'bn-1' : 'OL1M',
      workExternalId: source === 'open_library' ? 'OL1W' : null,
      isbn13: ISBN,
      title: 'Theoretical Physics',
      authors: ['Georg Joos'],
      publisher: 'Dover Publications',
      publicationYear: 1986,
      language: 'eng',
      binding: null,
      materialType: null,
      sourceUrl: 'https://example.test/record',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      payloadHash: payloadHash(payload),
      ...overrides,
    }),
    payload,
  };
}

test('BN adapter normalizes a matching ISBN and preserves source data', async () => {
  const adapter = createBnAdapter({
    requester: async (url) => ({ status: 'found', payload: { bibs: [bnRecord()] }, url }),
  });
  const result = await adapter.lookup(ISBN);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].externalRecordId, 'bn-1');
  assert.equal(result.records[0].isbn13, ISBN);
  assert.deepEqual(result.records[0].authors, ['Georg Joos']);
  assert.equal(result.records[0].workExternalId, null);
});

test('Open Library adapter resolves Edition, Work and author identifiers', async () => {
  const result = await createOpenLibraryAdapter({ requester: olRequester() }).lookup(ISBN);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].externalRecordId, 'OL1M');
  assert.equal(result.records[0].workExternalId, 'OL1W');
  assert.deepEqual(result.records[0].authors, ['Georg Joos']);
});

test('lookup reports records found in only one source', async (t) => {
  const bnFound = {
    source: 'bn',
    async lookup() {
      return { source: 'bn', status: 'found', records: [normalized('bn')] };
    },
  };
  const bnMissing = {
    source: 'bn',
    async lookup() {
      return { source: 'bn', status: 'not_found', records: [] };
    },
  };
  const olFound = {
    source: 'open_library',
    async lookup() {
      return { source: 'open_library', status: 'found', records: [normalized('open_library')] };
    },
  };
  const olMissing = {
    source: 'open_library',
    async lookup() {
      return { source: 'open_library', status: 'not_found', records: [] };
    },
  };
  await t.test('BN only', async () =>
    assert.equal(
      (await lookupISBN(ISBN, { bnAdapter: bnFound, openLibraryAdapter: olMissing })).comparison
        .status,
      'single_source',
    ),
  );
  await t.test('Open Library only', async () =>
    assert.equal(
      (await lookupISBN(ISBN, { bnAdapter: bnMissing, openLibraryAdapter: olFound })).comparison
        .status,
      'single_source',
    ),
  );
});

test('consistent source records have no conflicts', () => {
  assert.deepEqual(
    compareMetadataResults(
      { status: 'found', records: [normalized('bn')] },
      { status: 'found', records: [normalized('open_library')] },
    ),
    { status: 'consistent', conflicts: [] },
  );
});

test('conflicting source records are not treated as consistent', () => {
  const comparison = compareMetadataResults(
    { status: 'found', records: [normalized('bn')] },
    { status: 'found', records: [normalized('open_library', { title: 'A Different Book' })] },
  );
  assert.equal(comparison.status, 'conflict');
  assert.ok(comparison.conflicts.some((conflict) => conflict.field === 'title'));
});

test('multiple matching BN records stay separate and require review', async () => {
  const adapter = createBnAdapter({
    requester: async (url) => ({
      status: 'found',
      payload: { bibs: [bnRecord(), bnRecord({ id: 'bn-2', publisher: 'Another Publisher' })] },
      url,
    }),
  });
  const result = await adapter.lookup(ISBN);
  assert.equal(result.ambiguous, true);
  assert.equal(result.records.length, 2);
  assert.equal(
    compareMetadataResults(result, { status: 'not_found', records: [] }).status,
    'conflict',
  );
});

test('empty source responses are represented as not_found', async () => {
  const bn = await createBnAdapter({
    requester: async () => ({ status: 'found', payload: { bibs: [] } }),
  }).lookup(ISBN);
  const ol = await createOpenLibraryAdapter({
    requester: async () => ({ status: 'not_found' }),
  }).lookup(ISBN);
  assert.equal(bn.status, 'not_found');
  assert.equal(ol.status, 'not_found');
});

test('invalid JSON is classified as invalid_response', async () => {
  const requester = createJsonRequester({
    fetcher: async () => ({
      status: 200,
      url: 'https://example.test',
      headers: {},
      async json() {
        throw new SyntaxError('bad JSON');
      },
    }),
    limiter: { async acquire() {} },
    retries: 0,
  });
  assert.equal((await requester('https://example.test')).status, 'invalid_response');
});

test('timeouts, HTTP 429 and HTTP 5xx are temporary and retryable', async (t) => {
  await t.test('timeout', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const requester = createJsonRequester({
      fetcher: async () => {
        throw timeout;
      },
      limiter: { async acquire() {} },
      retries: 1,
      wait: async () => {},
    });
    assert.equal((await requester('https://example.test')).status, 'temporary_error');
  });
  for (const status of [429, 503]) {
    await t.test(`HTTP ${status}`, async () => {
      let calls = 0;
      const delays = [];
      const requester = createJsonRequester({
        fetcher: async () => {
          calls += 1;
          return {
            status,
            url: 'https://example.test',
            headers: { get: () => (status === 429 ? '2' : null) },
          };
        },
        limiter: { async acquire() {} },
        retries: 1,
        wait: async (delay) => delays.push(delay),
      });
      assert.equal((await requester('https://example.test')).status, 'temporary_error');
      assert.equal(calls, 2);
      if (status === 429) assert.equal(delays[0], 2_000);
    });
  }
});

test('positive cache prevents a repeated request and expires after 30 days', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  let calls = 0;
  const repository = new SqliteCatalogRepository(':memory:');
  const cache = new SqliteMetadataCache(repository, { now: () => now });
  const bnAdapter = {
    source: 'bn',
    async lookup() {
      calls += 1;
      return { source: 'bn', status: 'found', records: [normalized('bn')] };
    },
  };
  const olAdapter = {
    source: 'open_library',
    async lookup() {
      return { source: 'open_library', status: 'not_found', records: [] };
    },
  };
  try {
    assert.equal(
      (await lookupISBN(ISBN, { bnAdapter, openLibraryAdapter: olAdapter, cache })).bn.cache.hit,
      false,
    );
    assert.equal(
      (await lookupISBN(ISBN, { bnAdapter, openLibraryAdapter: olAdapter, cache })).bn.cache.hit,
      true,
    );
    assert.equal(calls, 1);
    now = new Date('2026-02-01T00:00:00.001Z');
    await lookupISBN(ISBN, { bnAdapter, openLibraryAdapter: olAdapter, cache });
    assert.equal(calls, 2);
  } finally {
    repository.close();
  }
});

test('not_found cache lasts 7 days and temporary errors are never cached', () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const repository = new SqliteCatalogRepository(':memory:');
  const cache = new SqliteMetadataCache(repository, { now: () => now });
  try {
    assert.equal(cache.set('bn', ISBN, { source: 'bn', status: 'not_found', records: [] }), true);
    assert.ok(cache.get('bn', ISBN));
    now = new Date('2026-01-08T00:00:00.001Z');
    assert.equal(cache.get('bn', ISBN), null);
    assert.equal(
      cache.set('bn', ISBN, { source: 'bn', status: 'temporary_error', records: [] }),
      false,
    );
  } finally {
    repository.close();
  }
});

test('a mismatched ISBN is invalid_response, not not_found', async () => {
  const bn = await createBnAdapter({
    requester: async (url) => ({
      status: 'found',
      payload: { bibs: [bnRecord({ isbnIssn: [OTHER_ISBN] })] },
      url,
    }),
  }).lookup(ISBN);
  const ol = await createOpenLibraryAdapter({
    requester: olRequester({ edition: edition({ isbn_13: [OTHER_ISBN] }) }),
  }).lookup(ISBN);
  assert.equal(bn.reason, 'isbn_mismatch');
  assert.equal(ol.reason, 'isbn_mismatch');
});

test('records missing required identifiers or titles are invalid_response', async () => {
  const bn = await createBnAdapter({
    requester: async (url) => ({
      status: 'found',
      payload: { bibs: [bnRecord({ id: null, title: null })] },
      url,
    }),
  }).lookup(ISBN);
  const ol = await createOpenLibraryAdapter({
    requester: olRequester({ edition: edition({ key: null }) }),
  }).lookup(ISBN);
  assert.equal(bn.reason, 'missing_required_fields');
  assert.equal(ol.reason, 'missing_required_fields');
});

test('SQLite persistence is transactional and idempotent without creating catalog editions', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const work = repository.createWork({ title: 'Existing Work' });
    const editionRow = repository.createEdition({ workId: work.id, title: 'Existing Edition' });
    const result = { status: 'found', records: [normalized('bn')] };
    const first = persistMetadataResults(repository, [result], {
      workId: work.id,
      editionId: editionRow.id,
    });
    assert.ok(first.externalRecordsCreated > 0);
    assert.ok(first.evidenceCreated > 0);
    assert.deepEqual(
      persistMetadataResults(repository, [result], { workId: work.id, editionId: editionRow.id }),
      { externalRecordsCreated: 0, evidenceCreated: 0 },
    );
    assert.equal(repository.counts().works, 1);
    assert.equal(repository.counts().editions, 1);
    assert.equal(repository.counts().external_records, 1);
  } finally {
    repository.close();
  }
});
