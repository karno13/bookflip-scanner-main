import test from 'node:test';
import assert from 'node:assert/strict';
import { readOfferNotes, saveOfferNotes } from '../app/views/offer-workspace.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('browser-local notes round trip without touching SQLite', () => {
  const local = storage();
  const data = { 'offer-1': { watched: true, note: 'Sprawdzić okładkę', targetPrice: 25, status: 'check' } };
  assert.equal(saveOfferNotes(data, local), true);
  assert.deepEqual(readOfferNotes(local), data);
});

test('corrupted local preferences recover as empty list', () => {
  const local = { getItem: () => '{invalid', setItem: () => {} };
  assert.deepEqual(readOfferNotes(local), {});
});

test('unavailable browser storage fails safely', () => {
  const local = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.deepEqual(readOfferNotes(local), {});
  assert.equal(saveOfferNotes({ test: true }, local), false);
});
