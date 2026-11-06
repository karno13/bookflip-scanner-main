import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupISBN } from './metadata-lookup.mjs';
import { findTitleIsbnCandidates } from './catalog-title-isbn.mjs';

for (const status of ['found', 'temporary_error', 'invalid_response', 'not_found']) {
  test(`BN ${status}: Open Library is called only after absence`, async () => {
    const calls = [];
    const result = await lookupISBN('9780306406157', {
      bnAdapter: { source: 'bn', lookup: async () => {
        calls.push('bn');
        return { status, records: status === 'found' ? [{ title: 'Physics' }] : [] };
      } },
      openLibraryAdapter: { source: 'open_library', lookup: async () => {
        calls.push('ol');
        return { status: 'not_found', records: [] };
      } },
    });
    assert.deepEqual(calls, status === 'not_found' ? ['bn', 'ol'] : ['bn']);
    assert.equal(result.openLibrary.status, status === 'not_found' ? 'not_found' : 'skipped');
  });
}

test('title discovery falls back after an empty BN response', async () => {
  const calls = [];
  const result = await findTitleIsbnCandidates('Physics', {
    requestBn: async () => { calls.push('bn'); return { status: 'found', payload: { bibs: [] } }; },
    requestOpenLibrary: async () => { calls.push('ol'); return { status: 'found', payload: {
      docs: [{ title: 'Physics', isbn: ['9780306406157'] }],
    } }; },
  });
  assert.deepEqual(calls, ['bn', 'ol']);
  assert.equal(result.candidates[0].source, 'open_library');
});
