import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('./app/styles.css', import.meta.url), 'utf8');

test('compact offers retain usable mobile controls and small-screen typography', () => {
  const compact = styles.slice(styles.lastIndexOf('/* Compact mobile density'));
  assert.ok(compact, 'compact stylesheet section is present');
  assert.match(compact, /@media \(max-width: 760px\)/);
  assert.match(compact, /\.mobile-offer\s*\{[^}]*min-height:\s*66px/);
  assert.match(compact, /\.catalog-row\s*\{[^}]*min-height:\s*80px/);
  assert.match(compact, /\.scanner-discover-toolbar input, \.scanner-discover-toolbar select\s*\{\s*height:\s*44px/);
  assert.match(compact, /\.pagination button\s*\{\s*min-height:\s*44px/);
  assert.match(compact, /@media \(max-width: 400px\)/);
});

test('mobile design uses an accessible two-column filter grid and motion preferences', () => {
  const visual = styles.slice(styles.lastIndexOf('/* BookFlip visual system'));
  assert.match(visual, /\.filterbar\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(visual, /\.filterbar \.search-field\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(visual, /\.filterbar input, \.filterbar select\s*\{[^}]*min-height:\s*44px/);
  assert.match(visual, /@media \(prefers-reduced-motion: reduce\)/);
});
