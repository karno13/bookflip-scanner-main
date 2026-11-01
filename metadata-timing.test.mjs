import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupISBN } from './metadata-lookup.mjs';

test('metadata lookups expose independent provider timings and cache origin', async () => {
  const result = await lookupISBN('9780306406157', {
    bnAdapter: { source: 'bn', lookup: async () => ({ status: 'not_found', records: [] }) },
    openLibraryAdapter: { source: 'open_library', lookup: async () => ({ status: 'not_found', records: [] }) },
    cache: {
      get: (source) => source === 'bn'
        ? { result: { status: 'not_found', records: [] }, fetchedAt: '2026-01-01', expiresAt: '2027-01-01' }
        : null,
      set: () => true,
    },
  });
  assert.equal(result.bn.timing.cached, true);
  assert.equal(result.openLibrary.timing.cached, false);
  assert.ok(Number.isInteger(result.bn.timing.durationMs));
  assert.ok(Number.isInteger(result.openLibrary.timing.durationMs));
  assert.equal(result.bn.cache.hit, true);
  assert.equal(result.openLibrary.cache.hit, false);
});
