import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const modules = ['review', 'catalog', 'offers'];

test('all workspace constructors receive both DOM selector helpers', async () => {
  for (const name of modules) {
    const source = await readFile(new URL(`./app/views/${name}.js`, import.meta.url), 'utf8');
    assert.match(source, /state, \$, \$\$, json/, name);
    assert.match(shell, new RegExp(`const ${name}View = create${name[0].toUpperCase()+name.slice(1)}View\\(\\{ state, \\\$[, ]+\\$\\$, json`), name);
  }
  assert.doesNotMatch(shell, /state, \$, \$, json/);
});
