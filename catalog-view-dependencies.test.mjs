import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const catalog = await readFile(new URL('./app/views/catalog.js', import.meta.url), 'utf8');
test('catalog receives its visible row pagination helper', () => {
  assert.match(catalog, /createCatalogView\(\{[^}]*visibleCatalogRows\s*\}\)/);
  assert.match(catalog, /visibleCatalogRows\('works', rows\)/);
  const init = shell.match(/const catalogView = createCatalogView\(\{[^}]*\}\);/);
  assert.ok(init, 'catalog view initialization exists');
  assert.ok(init[0].includes('visibleCatalogRows'), 'visible rows injected');
});
