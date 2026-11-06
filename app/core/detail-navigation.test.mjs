import test from 'node:test';
import assert from 'node:assert/strict';
import { installDetailNavigation, openDetailView } from './detail-navigation.js';

test('mobile detail navigation restores the list position without replacing form content', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let mobile = true;
  const classes = new Set();
  const buttons = new Map();
  const form = { value: 'Niezapisana notatka' };
  const trigger = { isConnected: true, focused: false, focus() { this.focused = true; } };
  const view = {
    classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
    querySelector(selector) {
      if (selector === '.detail-back') return buttons.get('back');
      if (selector === '.catalog-layout') return { before(button) { buttons.set('back', button); } };
      return null;
    },
    form,
  };
  globalThis.window = { scrollY: 340, matchMedia: () => ({ matches: mobile }), scrollTo({ top }) { this.scrollY = top; } };
  globalThis.document = {
    activeElement: trigger,
    querySelector: selector => selector === '#view-catalog' ? view : null,
    createElement: () => ({ setAttribute() {}, addEventListener(event, callback) { this[event] = callback; }, focus() {} }),
  };
  try {
    installDetailNavigation();
    openDetailView('catalog');
    assert.equal(classes.has('detail-is-open'), true);
    assert.equal(window.scrollY, 0);
    buttons.get('back').click();
    assert.equal(classes.has('detail-is-open'), false);
    assert.equal(window.scrollY, 340);
    assert.equal(trigger.focused, true);
    assert.equal(view.form, form);
    assert.equal(form.value, 'Niezapisana notatka');
    mobile = false;
    openDetailView('catalog');
    assert.equal(classes.has('detail-is-open'), false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
