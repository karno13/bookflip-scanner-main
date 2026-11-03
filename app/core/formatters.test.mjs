import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, money, date, shortTime, zlotyToGrosze, groszeToZloty, moneyFromZloty } from './formatters.js';

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

test('złoty inputs and grosze stored prices share an explicit money conversion', () => {
  assert.equal(groszeToZloty(2500), 25);
  assert.equal(zlotyToGrosze(29.99), 2999);
  assert.equal(zlotyToGrosze(0.01), 1);
  assert.equal(zlotyToGrosze(-1), null);
  assert.match(moneyFromZloty(25), /25,00/);
  assert.match(moneyFromZloty(29.99), /29,99/);
});
