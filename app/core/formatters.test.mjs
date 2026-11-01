import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, money, date, shortTime } from './formatters.js';

test('escapeHtml encodes HTML markup and attributes', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'bad\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
});

test('price and date formatters handle missing data', () => {
  assert.equal(money(null), '-');
  assert.match(money(1234), /12,34/);
  assert.equal(date(''), '-');
  assert.equal(shortTime(null), '-');
});
