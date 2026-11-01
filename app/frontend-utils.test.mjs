import test from 'node:test';
import assert from 'node:assert/strict';
import { readSavedSearch, validateCatalogPage } from './frontend-utils.js';

test('saved search does not crash on corrupt or malformed localStorage', () => {
  assert.equal(readSavedSearch({ getItem: () => '{bad' }), null);
  assert.deepEqual(readSavedSearch({ getItem: () => '{"queries":["a",4],"sources":["Vinted",null]}' }), { queries: ['a'], sources: ['Vinted'] });
  assert.equal(readSavedSearch({ getItem: () => '[]' }), null);
});

test('catalog page validation rejects inconsistent responses', () => {
  assert.equal(validateCatalogPage({ total: 3, items: [1] }, 2, 0).total, 3);
  assert.throws(() => validateCatalogPage({ total: 1, items: [1, 2] }, 2, 0), /INVALID_CATALOG_PAGE/);
  assert.throws(() => validateCatalogPage({ total: 4, items: [] }, 2, 0), /INVALID_CATALOG_PAGE/);
  assert.throws(() => validateCatalogPage({ total: 1, items: [] }, 2, 2), /INVALID_CATALOG_PAGE/);
});
