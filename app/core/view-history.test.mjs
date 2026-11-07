import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFromSearch, urlForView, shouldPush, VIEWS } from './view-history.js';

test('viewFromSearch accepts known views and falls back to the scanner', () => {
  assert.equal(viewFromSearch(''), 'scanner');
  assert.equal(viewFromSearch('?view=catalog'), 'catalog');
  assert.equal(viewFromSearch('?view=nope'), 'scanner');
  assert.equal(viewFromSearch('?view=catalog&x=1'), 'catalog');
  for (const name of VIEWS) assert.equal(viewFromSearch('?view=' + name), name);
});

test('urlForView maps the scanner to the root and others to ?view=', () => {
  assert.equal(urlForView('scanner'), '/');
  assert.equal(urlForView('offers'), '/?view=offers');
  assert.equal(urlForView('bogus'), '/');
});

test('shouldPush skips the initial render and repeated visits to the same URL', () => {
  assert.equal(shouldPush('/', 'scanner', true), false);
  assert.equal(shouldPush('/', 'catalog', true), false);
  assert.equal(shouldPush('/', 'catalog', false), true);
  assert.equal(shouldPush('/?view=catalog', 'catalog', false), false);
  assert.equal(shouldPush('/?view=catalog', 'scanner', false), true);
});

test('item ids round-trip through the URL only for list/detail views', async () => {
  const { idFromSearch } = await import('./view-history.js');
  assert.equal(urlForView('catalog', 'w 1/2'), '/?view=catalog&id=w%201%2F2');
  assert.equal(idFromSearch('?view=catalog&id=w%201%2F2'), 'w 1/2');
  assert.equal(urlForView('offers', 'x'), '/?view=offers');
  assert.equal(urlForView('scanner', 'x'), '/');
  assert.equal(idFromSearch('?view=review'), null);
  assert.equal(idFromSearch('?id=' + 'a'.repeat(300)), null);
});

test('shouldPush ignores the selected item in the current address', () => {
  assert.equal(shouldPush('/?view=catalog&id=5', 'catalog', false), false);
  assert.equal(shouldPush('/?view=catalog&id=5', 'review', false), true);
});
