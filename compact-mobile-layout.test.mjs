import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = (await Promise.all(['styles.css','mobile-repair.css'].map(file => readFile(new URL('./app/' + file, import.meta.url), 'utf8')))).join('\n');

test('compact offers retain usable mobile controls and small-screen typography', () => {
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /font-size:16px;min-height:44px/);
  assert.match(styles, /\.mobile-offer\{grid-template-columns:minmax\(0,1fr\) 90px/);
  assert.match(styles, /\.pagination\{/);
});

test('mobile design uses an accessible two-column filter grid and motion preferences', () => {
  assert.match(styles, /\.filterbar select,\.filterbar \.field\{flex-basis:120px/);
  assert.match(styles, /\.filterbar \.search-field\{flex-basis:100%/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});
