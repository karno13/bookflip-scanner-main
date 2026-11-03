import assert from 'node:assert/strict';
import test from 'node:test';
import { findTitleIsbnCandidates } from './catalog-title-isbn.mjs';

test('title discovery returns bounded deduplicated ISBN candidates from BN and Open Library', async () => {
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
        { title: 'Theoretical Physics', isbn: ['9780306406157','9783161484100'], language: ['eng'] },
      ] } };
    },
  });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.isbn), ['9780306406157','9783161484100']);
  assert.ok(requests[0].includes('title=Theoretical+Physics'));
  assert.ok(requests[1].includes('fields=key%2Ctitle%2Cauthor_name%2Cisbn'));
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
