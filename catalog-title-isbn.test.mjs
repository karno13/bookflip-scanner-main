import assert from 'node:assert/strict';
import test from 'node:test';
import { findTitleIsbnCandidates } from './catalog-title-isbn.mjs';

test('title discovery returns bounded deduplicated ISBN candidates from BN without querying Open Library', async () => {
  const requests = [];
  const result = await findTitleIsbnCandidates('Theoretical Physics', {
    requestBn: async (url) => {
      requests.push(url);
      return { status: 'found', payload: { bibs: [
        { title: 'Theoretical Physics', isbnIssn: ['9780306406157'] },
        { title: 'Invalid ISBN', isbnIssn: ['1234567890'] },
      ] } };
    },
    requestOpenLibrary: async (url) => {
      requests.push(url);
      return { status: 'found', payload: { docs: [
        { title: 'Theoretical Physics', isbn: ['9780306406157'], language: ['eng'] },
      ] } };
    },
  });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates.map((item) => item.isbn), ['9780306406157']);
  assert.ok(requests[0].includes('title=Theoretical+Physics'));
  assert.equal(requests.length, 1);
});

test('title discovery reports unavailable metadata source without inventing ISBN', async () => {
  const result = await findTitleIsbnCandidates('Warhammer title', {
    requestBn: async () => ({ status: 'temporary_error' }),
    requestOpenLibrary: async () => ({ status: 'found', payload: { docs: [{ title: 'Warhammer title', isbn: [] }] } }),
  });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.unavailable, ['bn']);
  await assert.rejects(() => findTitleIsbnCandidates('ab', {
    requestBn: async () => ({ status: 'not_found' }),
    requestOpenLibrary: async () => ({ status: 'not_found' }),
  }), /TITLE_TOO_SHORT/);
});

test('an ISBN-10 and ISBN-13 of the same edition yield one candidate; articles are ignored', async () => {
  const result = await findTitleIsbnCandidates('Przebudzenie cieni', {
    requestBn: async () => ({
      status: 'found',
      payload: {
        bibs: [
          { title: 'Przebudzenie cieni', kind: 'książka', isbnIssn: ['8366575152', '9788366575158'] },
          { title: 'Przebudzenie cieni (artykuł)', kind: 'artykuł', isbnIssn: ['9780306406157'] },
        ],
      },
    }),
    requestOpenLibrary: async () => ({ status: 'not_found' }),
  });
  assert.deepEqual(result.candidates.map((item) => item.isbn), ['9788366575158']);
});
