import assert from 'node:assert/strict';
import test from 'node:test';

import { createBnAdapter } from './metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from './metadata-sources/open-library.mjs';

const ISBN10 = '0306406152';
const ISBN13 = '9780306406157';

test('BN accepts an ISBN-10 query when the record exposes the equivalent ISBN-13', async () => {
  const adapter = createBnAdapter({ requester: async (url) => ({
    status: 'found',
    url,
    payload: { bibs: [{ id: 123, isbnIssn: ISBN13, title: 'Theoretical Physics' }] },
  }) });
  const result = await adapter.lookup(ISBN10);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].isbn13, ISBN13);
});

test('Open Library accepts ISBN-10 and preserves the returned edition identifiers', async () => {
  const requester = async (url) => {
    if (url.includes('/isbn/')) return {
      status: 'found',
      url,
      payload: { key: '/books/OL10M', title: 'Theoretical Physics', isbn_13: [ISBN13], works: [{ key: '/works/OL10W' }] },
    };
    return { status: 'found', url, payload: { key: '/works/OL10W', authors: [] } };
  };
  const result = await createOpenLibraryAdapter({ requester }).lookup(ISBN10);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].externalRecordId, 'OL10M');
  assert.equal(result.records[0].isbn13, ISBN13);
});
