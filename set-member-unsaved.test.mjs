import test from 'node:test';
import assert from 'node:assert/strict';
import { watchForm, hasUnsavedChanges, allowDiscard } from './app/core/ux.js';

test('saving one set member does not clear unsaved changes in another', () => {
  const first = new EventTarget();
  const second = new EventTarget();
  first.value = '1'; second.value = '1';
  const saveFirst = watchForm('test-first', [first]);
  watchForm('test-second', [second]);
  first.value = '2'; first.dispatchEvent(new Event('input'));
  second.value = '3'; second.dispatchEvent(new Event('input'));
  saveFirst();
  assert.equal(hasUnsavedChanges(), true);
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    assert.equal(allowDiscard(), true);
    assert.equal(first.value, '2');
    assert.equal(second.value, '1');
    assert.equal(hasUnsavedChanges(), false);
  } finally { globalThis.confirm = previousConfirm; }
});
