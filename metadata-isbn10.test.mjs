import assert from 'node:assert/strict';
import test from 'node:test';

import { createBnAdapter } from './metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from './metadata-sources/open-library.mjs';

const ISBN10 = '0306406152';
const ISBN13 = '9780306406157';

test('BN accepts an ISBN-10 query when the record exposes the equivalent ISBN-13', async () => {
  const adapter = createBnAdapter({
    requester: async (url) => ({
      status: 'found',
      url,
      payload: { bibs: [{ id: 123, isbnIssn: ISBN13, title: 'Theoretical Physics' }] },
    }),
  });
  const result = await adapter.lookup(ISBN10);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].isbn13, ISBN13);
});

test('Open Library accepts ISBN-10 and preserves the returned edition identifiers', async () => {
  const requester = async (url) => {
    if (url.includes('/isbn/'))
      return {
        status: 'found',
        url,
        payload: {
          key: '/books/OL10M',
          title: 'Theoretical Physics',
          isbn_13: [ISBN13],
          works: [{ key: '/works/OL10W' }],
        },
      };
    return { status: 'found', url, payload: { key: '/works/OL10W', authors: [] } };
  };
  const result = await createOpenLibraryAdapter({ requester }).lookup(ISBN10);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].externalRecordId, 'OL10M');
  assert.equal(result.records[0].isbn13, ISBN13);
});

test('BN retries the ISBN-10 form when the ISBN-13 query returns nothing', async () => {
  // Real case: "Zabójca bestii" (9788386758289) is only indexed by BN under 8386758287.
  const asked = [];
  const adapter = createBnAdapter({
    requester: async (url) => {
      const isbn = new URL(url).searchParams.get('isbnIssn');
      asked.push(isbn);
      const payload =
        isbn === '8386758287'
          ? { bibs: [{ id: 77, isbnIssn: '8386758287', title: 'Zabójca bestii' }] }
          : { bibs: [] };
      return { status: 'found', url, payload };
    },
  });
  const result = await adapter.lookup('9788386758289');
  assert.deepEqual(asked, ['9788386758289', '8386758287']);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].isbn10, '8386758287');
});

test('BN reports not_found only after every equivalent ISBN form came back empty', async () => {
  const asked = [];
  const adapter = createBnAdapter({
    requester: async (url) => {
      asked.push(new URL(url).searchParams.get('isbnIssn'));
      return { status: 'found', url, payload: { bibs: [] } };
    },
  });
  const result = await adapter.lookup('9788375060041');
  assert.equal(result.status, 'not_found');
  assert.equal(asked.length, 2);
});

test('BN does not send a second request when the first form already matched', async () => {
  let calls = 0;
  const adapter = createBnAdapter({
    requester: async (url) => {
      calls++;
      return { status: 'found', url, payload: { bibs: [{ id: 1, isbnIssn: ISBN13, title: 'T' }] } };
    },
  });
  await adapter.lookup(ISBN13);
  assert.equal(calls, 1);
});
